import { audit, ContextError, invites, membership, withMember, withWorkspace, workspaces } from "@et/db";
import { Hono, type Context } from "hono";
import type { authRoutes, Vars } from "./auth";
import { randomToken } from "./crypto";
import type { AppEnv } from "./env";
import { hashToken } from "./overlay";

const EMAIL = /^[^\s@<>]{1,64}@[^\s@<>]{1,255}\.[^\s@<>]{2,63}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function memberManageRoutes(auth: ReturnType<typeof authRoutes>) {
  const app = new Hono<{ Bindings: AppEnv; Variables: Vars }>();
  const guard = [auth.configured, auth.requireMember] as const;
  type Ctx = Context<{ Bindings: AppEnv; Variables: Vars }>;

  async function current(c: Ctx) {
    try {
      return await withWorkspace(c.var.db, { memberId: c.var.memberId, workspaceId: c.req.param("id") ?? "" }, (tx) => workspaces.current(tx));
    } catch (error) {
      if (error instanceof ContextError) return null;
      throw error;
    }
  }
  const ctx = (c: Ctx, workspaceId: string) => ({ memberId: c.var.memberId, workspaceId });

  app.post("/workspaces/:id/invites", ...guard, async (c) => {
    const ws = await current(c);
    if (!ws) return c.json({ error: "not_found" }, 404);
    if (ws.role !== "owner") return c.json({ error: "forbidden" }, 403);
    const body = (await c.req.json().catch(() => null)) as { email?: unknown } | null;
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!EMAIL.test(email) || email.length > 320) return c.json({ error: "invalid_email" }, 400);
    const token = randomToken();
    try {
      await withWorkspace(c.var.db, ctx(c, ws.id), async (tx) => invites.create(tx, email, await hashToken(token)));
    } catch (error) {
      if ((error as { code?: string }).code === "54000") return c.json({ error: "too_many_invites" }, 429);
      throw error;
    }
    return c.json({ url: `${new URL(c.req.url).origin}/invite/${token}` }, 201);
  });

  app.get("/workspaces/:id/invites", ...guard, async (c) => {
    const ws = await current(c);
    if (!ws) return c.json({ error: "not_found" }, 404);
    if (ws.role !== "owner") return c.json({ error: "forbidden" }, 403);
    return c.json({ invites: await withWorkspace(c.var.db, ctx(c, ws.id), (tx) => invites.pending(tx)) });
  });

  app.delete("/workspaces/:id/invites/:inviteId", ...guard, async (c) => {
    const ws = await current(c);
    if (!ws) return c.json({ error: "not_found" }, 404);
    if (ws.role !== "owner") return c.json({ error: "forbidden" }, 403);
    const inviteId = c.req.param("inviteId");
    if (!UUID.test(inviteId)) return c.json({ error: "not_found" }, 404);
    const revoked = await withWorkspace(c.var.db, ctx(c, ws.id), async (tx) => {
      const ok = await invites.revoke(tx, inviteId);
      if (ok) await audit.log(tx, "invite_revoked", { invite_id: inviteId });
      return ok;
    });
    return revoked ? c.body(null, 204) : c.json({ error: "not_found" }, 404);
  });

  app.post("/invites/accept", ...guard, async (c) => {
    const body = (await c.req.json().catch(() => null)) as { token?: unknown } | null;
    const token = typeof body?.token === "string" ? body.token : "";
    if (!TOKEN.test(token)) return c.json({ error: "invalid" }, 404);
    const result = await withMember(c.var.db, { memberId: c.var.memberId }, async (tx) => invites.accept(tx, await hashToken(token)));
    if (result.outcome === "invalid") return c.json({ error: "invalid" }, 404);
    if (result.outcome === "email_mismatch") return c.json({ error: "email_mismatch" }, 403);
    return c.json({ workspaceId: result.workspaceId, outcome: result.outcome });
  });

  app.delete("/workspaces/:id/members/:memberId", ...guard, async (c) => {
    const ws = await current(c);
    if (!ws) return c.json({ error: "not_found" }, 404);
    const target = c.req.param("memberId");
    if (!UUID.test(target)) return c.json({ error: "not_found" }, 404);
    const leaving = target === c.var.memberId;
    if (leaving && ws.role === "owner") return c.json({ error: "owner_cannot_leave" }, 400);
    if (!leaving && ws.role !== "owner") return c.json({ error: "forbidden" }, 403);
    // Logged first: once a moderator has left, they're no longer allowed to write to this workspace's log.
    const removed = await withWorkspace(c.var.db, ctx(c, ws.id), async (tx) => {
      await audit.log(tx, leaving ? "member_left" : "member_removed", leaving ? {} : { member_id: target });
      return membership.remove(tx, target);
    });
    return removed ? c.body(null, 204) : c.json({ error: "not_found" }, 404);
  });

  app.get("/workspaces/:id/audit", ...guard, async (c) => {
    const ws = await current(c);
    if (!ws) return c.json({ error: "not_found" }, 404);
    if (ws.role !== "owner") return c.json({ error: "forbidden" }, 403);
    return c.json({ events: await withWorkspace(c.var.db, ctx(c, ws.id), (tx) => audit.recent(tx, 100)) });
  });

  return app;
}
