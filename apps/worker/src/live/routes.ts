import { audit, ContextError, seasons, withWorkspace, workspaces, youtube } from "@et/db";
import type { PollInput } from "@et/core";
import { ChatSourceError } from "@et/youtube";
import { Hono, type Context } from "hono";
import type { SessionResponse, SessionStartError, SessionStatus } from "../api-types";
import type { authRoutes, Vars } from "../auth";
import type { AppDeps, AppEnv } from "../env";
import { googleCredentials } from "./clients";
import { ReconnectRequiredError, type Result } from "./engine";
import { LiveSourceProvider } from "./sources";

type Ctx = Context<{ Bindings: AppEnv; Variables: Vars }>;

const ERROR_STATUS = { already_live: 409, not_live: 409, poll_open: 409, no_poll: 404, invalid_poll: 400 } as const;

function parsePollInput(body: unknown): PollInput | null {
  if (typeof body !== "object" || body === null) return null;
  const { question, options, voteChange } = body as Record<string, unknown>;
  if (typeof question !== "string" || !Array.isArray(options) || !options.every((o) => typeof o === "string")) return null;
  if (voteChange !== undefined && voteChange !== "first" && voteChange !== "latest") return null;
  return { question, options: options as string[], ...(voteChange && { voteChange }) };
}

export function sessionRoutes(auth: ReturnType<typeof authRoutes>, deps: AppDeps) {
  const app = new Hono<{ Bindings: AppEnv; Variables: Vars }>();
  const guard = [auth.configured, auth.requireMember] as const;

  async function member(c: Ctx): Promise<{ workspaceId: string } | Response> {
    const workspaceId = c.req.param("id") ?? "";
    try {
      const current = await withWorkspace(c.var.db, { memberId: c.var.memberId, workspaceId }, (tx) => workspaces.current(tx));
      // The canonical id from the database, never the raw path: UUID case variants must map to the same DO and quota key.
      return current ? { workspaceId: current.id } : c.json({ error: "not_found" }, 404);
    } catch (error) {
      if (error instanceof ContextError) return c.json({ error: "not_found" }, 404);
      throw error;
    }
  }

  async function respond(c: Ctx, workspaceId: string, session: SessionStatus, status: 200 | 201 = 200) {
    const usage = await deps.quota(c.env).usage(workspaceId);
    const quota = {
      day: usage.day,
      workspaceUsed: usage.workspaceUsed,
      workspaceLimit: usage.workspaceLimit,
      projectHeadroomLow: usage.projectUsed >= usage.projectLimit * 0.8,
      demoStartsLeft: usage.demoStartsLeft,
    };
    return c.json<SessionResponse>({ session, quota }, status);
  }

  function fromResult(c: Ctx, workspaceId: string, result: Result<SessionStatus>, status: 200 | 201 = 200) {
    return result.ok ? respond(c, workspaceId, result.value, status) : c.json({ error: result.error }, ERROR_STATUS[result.error]);
  }

  const logSession = (c: Ctx, workspaceId: string, action: "session_started" | "session_stopped", detail: Record<string, unknown>) =>
    withWorkspace(c.var.db, { memberId: c.var.memberId, workspaceId }, (tx) => audit.log(tx, action, detail));

  async function started(c: Ctx, workspaceId: string, mode: string, result: Result<SessionStatus>) {
    if (result.ok) await logSession(c, workspaceId, "session_started", { mode });
    return fromResult(c, workspaceId, result, 201);
  }

  const startError = (c: Ctx, error: SessionStartError, status: 409 | 429 | 502 | 503) => c.json({ error }, status);
  const live = async (c: Ctx, workspaceId: string) => (await deps.liveSession(c.env, workspaceId).status()).status === "live";

  app.get("/workspaces/:id/session", ...guard, async (c) => {
    const m = await member(c);
    if (m instanceof Response) return m;
    return respond(c, m.workspaceId, await deps.liveSession(c.env, m.workspaceId).status());
  });

  app.post("/workspaces/:id/session", ...guard, async (c) => {
    const m = await member(c);
    if (m instanceof Response) return m;
    if (String(c.env.SESSIONS_DISABLED) === "true") return startError(c, "disabled", 503);
    const body = (await c.req.json().catch(() => null)) as { mode?: unknown } | null;
    const mode = body?.mode === "demo" ? "demo" : body?.mode === "youtube" ? "youtube" : null;
    if (!mode) return c.json({ error: "invalid_mode" }, 400);
    const client = deps.liveSession(c.env, m.workspaceId);
    const season = await withWorkspace(c.var.db, { memberId: c.var.memberId, workspaceId: m.workspaceId }, (tx) => seasons.active(tx));
    const common = {
      workspaceId: m.workspaceId,
      startedBy: c.var.memberId,
      seasonId: season?.id ?? null,
      seasonName: season?.name ?? null,
      seasonEndsAt: season?.endsAt ?? null,
    };

    if (mode === "demo") {
      if (await live(c, m.workspaceId)) return startError(c, "already_live", 409);
      if (!(await deps.quota(c.env).reserveDemo(m.workspaceId))) return startError(c, "demo_limit", 429);
      return started(c, m.workspaceId, mode, await client.start({ ...common, mode, broadcastId: "demo", liveChatId: "demo" }));
    }

    const ciphertext = await withWorkspace(c.var.db, { memberId: c.var.memberId, workspaceId: m.workspaceId }, (tx) => youtube.refreshTokenCiphertext(tx));
    if (!ciphertext) return startError(c, "not_connected", 409);
    const provider = new LiveSourceProvider({
      fetch: deps.fetch,
      quota: deps.quota(c.env),
      clock: { now: deps.now },
      credentials: () => googleCredentials(c.env),
    });
    let chat;
    try {
      chat = await provider.youtube(m.workspaceId, ciphertext).findActiveLiveChat();
    } catch (error) {
      if (error instanceof ReconnectRequiredError) return startError(c, "reconnect_required", 409);
      if (error instanceof ChatSourceError && error.kind === "quota") return startError(c, "quota_exhausted", 429);
      return startError(c, "youtube_unavailable", 502);
    }
    if (!chat) return startError(c, "not_live", 409);
    return started(
      c,
      m.workspaceId,
      mode,
      await client.start({ ...common, mode, broadcastId: chat.broadcastId, liveChatId: chat.liveChatId, tokenCiphertext: ciphertext }),
    );
  });

  app.delete("/workspaces/:id/session", ...guard, async (c) => {
    const m = await member(c);
    if (m instanceof Response) return m;
    const client = deps.liveSession(c.env, m.workspaceId);
    const wasLive = (await client.status()).status === "live";
    const stopped = await client.stop("manual");
    if (wasLive) await logSession(c, m.workspaceId, "session_stopped", {});
    return respond(c, m.workspaceId, stopped);
  });

  app.post("/workspaces/:id/session/poll", ...guard, async (c) => {
    const m = await member(c);
    if (m instanceof Response) return m;
    const input = parsePollInput(await c.req.json().catch(() => null));
    if (!input) return c.json({ error: "invalid_poll" }, 400);
    return fromResult(c, m.workspaceId, await deps.liveSession(c.env, m.workspaceId).createPoll(input), 201);
  });

  app.post("/workspaces/:id/session/poll/close", ...guard, async (c) => {
    const m = await member(c);
    if (m instanceof Response) return m;
    return fromResult(c, m.workspaceId, await deps.liveSession(c.env, m.workspaceId).closePoll());
  });

  return app;
}
