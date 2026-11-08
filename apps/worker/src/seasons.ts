import { cleanSeasonName, isChannelId, PointsError, seasonWindow } from "@et/core";
import { audit, ContextError, points, seasons, withWorkspace, workspaces } from "@et/db";
import { Hono, type Context } from "hono";
import type { authRoutes, Vars } from "./auth";
import type { AppDeps, AppEnv } from "./env";

export interface SeasonView {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
}

export interface SeasonsResponse {
  active: SeasonView | null;
  recent: SeasonView[];
}

export interface LeaderboardRow {
  rank: number;
  points: number;
  joins: number;
  votes: number;
  channelId?: string;
}

export function seasonRoutes(auth: ReturnType<typeof authRoutes>, deps: AppDeps) {
  const app = new Hono<{ Bindings: AppEnv; Variables: Vars }>();
  const guard = [auth.configured, auth.requireMember] as const;

  async function current(c: Context<{ Bindings: AppEnv; Variables: Vars }>) {
    try {
      return await withWorkspace(c.var.db, { memberId: c.var.memberId, workspaceId: c.req.param("id") ?? "" }, (tx) => workspaces.current(tx));
    } catch (error) {
      if (error instanceof ContextError) return null;
      throw error;
    }
  }
  const ctx = (c: Context<{ Bindings: AppEnv; Variables: Vars }>, workspaceId: string) => ({ memberId: c.var.memberId, workspaceId });

  app.get("/workspaces/:id/seasons", ...guard, async (c) => {
    const ws = await current(c);
    if (!ws) return c.json({ error: "not_found" }, 404);
    const body = await withWorkspace(c.var.db, ctx(c, ws.id), async (tx) => ({ active: await seasons.active(tx), recent: await seasons.recent(tx) }));
    return c.json<SeasonsResponse>(body);
  });

  app.post("/workspaces/:id/seasons", ...guard, async (c) => {
    const ws = await current(c);
    if (!ws) return c.json({ error: "not_found" }, 404);
    if (ws.role !== "owner") return c.json({ error: "forbidden" }, 403);
    const body = (await c.req.json().catch(() => null)) as { name?: unknown; days?: unknown } | null;
    let name: string;
    const days = typeof body?.days === "number" ? body.days : NaN;
    try {
      name = cleanSeasonName(typeof body?.name === "string" ? body.name : "");
      seasonWindow(deps.now(), days);
    } catch (error) {
      if (error instanceof PointsError) return c.json({ error: error.code }, 400);
      throw error;
    }
    const created = await withWorkspace(c.var.db, ctx(c, ws.id), async (tx) => {
      const season = await seasons.create(tx, name, days);
      if (season) await audit.log(tx, "season_started", { season_id: season.id, days });
      return season;
    });
    return created ? c.json(created, 201) : c.json({ error: "season_running" }, 409);
  });

  app.post("/workspaces/:id/seasons/end", ...guard, async (c) => {
    const ws = await current(c);
    if (!ws) return c.json({ error: "not_found" }, 404);
    if (ws.role !== "owner") return c.json({ error: "forbidden" }, 403);
    const ended = await withWorkspace(c.var.db, ctx(c, ws.id), async (tx) => {
      const ok = await seasons.endActive(tx);
      if (ok) await audit.log(tx, "season_ended", {});
      return ok;
    });
    return ended ? c.body(null, 204) : c.json({ error: "no_season" }, 404);
  });

  // Channel ids only for the owner, who needs them to honour erasure requests (FR-12).
  app.get("/workspaces/:id/leaderboard", ...guard, async (c) => {
    const ws = await current(c);
    if (!ws) return c.json({ error: "not_found" }, 404);
    const rows = await withWorkspace(c.var.db, ctx(c, ws.id), async (tx) => {
      const active = await seasons.active(tx);
      return active ? points.top(tx, active.id, 50) : [];
    });
    const entries: LeaderboardRow[] = rows.map((r, i) => ({
      rank: i + 1,
      points: r.points,
      joins: r.joins,
      votes: r.votes,
      ...(ws.role === "owner" && { channelId: r.channelId }),
    }));
    return c.json({ entries });
  });

  app.delete("/workspaces/:id/viewers/:channelId", ...guard, async (c) => {
    const ws = await current(c);
    if (!ws) return c.json({ error: "not_found" }, 404);
    if (ws.role !== "owner") return c.json({ error: "forbidden" }, 403);
    const channelId = c.req.param("channelId");
    if (!isChannelId(channelId)) return c.json({ error: "invalid_channel_id" }, 400);
    // Live session first: it waits for any in-flight flush and stops crediting the viewer, so the delete below sticks.
    await deps.liveSession(c.env, ws.id).eraseViewer(channelId);
    // The log records that an erasure happened and how many rows went, never which viewer.
    const removed = await withWorkspace(c.var.db, ctx(c, ws.id), async (tx) => {
      const rows = await points.eraseViewer(tx, channelId);
      await audit.log(tx, "viewer_erased", { rows });
      return rows;
    });
    return c.json({ removedRows: removed });
  });

  return app;
}
