import { ContextError, members, sessions, withMember, withSystem, withWorkspace, workspaces, youtube, type Database } from "@et/db";
import { fetchMyChannel } from "@et/youtube";
import type { Context } from "hono";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import type { MeResponse, SignInOutcome, WorkspaceResponse } from "./api-types";
import {
  clearSessionCookie,
  readSessionCookie,
  SESSION_IDLE_SECONDS,
  SESSION_TTL_SECONDS,
  sessionHash,
  setOAuthCookie,
  setSessionCookie,
  takeOAuthCookie,
} from "./cookies";
import { decryptFromHex, encryptToHex, importAesKey, importHmacKey, randomToken, sha256Base64Url } from "./crypto";
import type { AppDeps, AppEnv } from "./env";
import { buildAuthUrl, exchangeCode, GOOGLE, revokeToken, verifyIdToken, type TokenSet } from "./google";

interface AuthConfig {
  clientId: string;
  clientSecret: string;
  sessionKey: CryptoKey;
  tokenKey: CryptoKey;
}

type Vars = { db: Database; memberId: string; config: AuthConfig };
type Ctx = Context<{ Bindings: AppEnv; Variables: Vars }>;

async function loadConfig(env: AppEnv): Promise<AuthConfig | null> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.SESSION_SECRET || !env.TOKEN_ENCRYPTION_KEY) return null;
  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    sessionKey: await importHmacKey(env.SESSION_SECRET),
    tokenKey: await importAesKey(env.TOKEN_ENCRYPTION_KEY),
  };
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const isUniqueViolation = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: unknown }).code === "23505";

export function authRoutes(deps: AppDeps) {
  const app = new Hono<{ Bindings: AppEnv; Variables: Vars }>();
  const nowSeconds = () => Math.floor(deps.now().getTime() / 1000);
  const redirectUri = (c: Ctx) => `${new URL(c.req.url).origin}/api/auth/google/callback`;
  const revokeQuietly = (token: string) => revokeToken(deps.fetch, token).catch(() => undefined);

  const configured = createMiddleware<{ Bindings: AppEnv; Variables: Vars }>(async (c, next) => {
    const config = await loadConfig(c.env);
    const db = deps.database(c.env);
    if (!config || !db) return c.json({ error: "not_configured" }, 503);
    c.set("config", config);
    c.set("db", db);
    await next();
  });

  const requireMember = createMiddleware<{ Bindings: AppEnv; Variables: Vars }>(async (c, next) => {
    const token = readSessionCookie(c);
    if (!token) return c.json({ error: "unauthenticated" }, 401);
    const hash = await sessionHash(c.var.config.sessionKey, token);
    const memberId = await withSystem(c.var.db, (tx) => sessions.memberFor(tx, hash, SESSION_IDLE_SECONDS));
    if (!memberId) {
      clearSessionCookie(c);
      return c.json({ error: "unauthenticated" }, 401);
    }
    c.set("memberId", memberId);
    await next();
  });

  async function connectCreator(c: Ctx, memberId: string, tokens: TokenSet): Promise<SignInOutcome | null> {
    const { db, config } = c.var;
    const owned = await withMember(db, { memberId }, async (tx) => (await workspaces.listMine(tx)).find((w) => w.role === "owner"));
    const connected = owned ? (await withWorkspace(db, { memberId, workspaceId: owned.id }, (tx) => youtube.current(tx))) !== null : false;
    // Google's revoke ends the whole grant, so discarding a new token must not kill an existing connection.
    const discard = async () => {
      if (tokens.refreshToken && !connected) await revokeQuietly(tokens.refreshToken);
    };

    if (!tokens.scopes.includes(GOOGLE.youtubeScope)) {
      await discard();
      return "youtube_denied";
    }
    if (!tokens.refreshToken) return "no_refresh_token";
    const refreshToken = tokens.refreshToken;

    let channel;
    try {
      channel = await fetchMyChannel(tokens.accessToken, deps.fetch);
    } catch {
      await discard();
      return "youtube_error";
    }
    if (!channel) {
      await discard();
      return "no_channel";
    }

    const workspaceId =
      owned?.id ?? (await withMember(db, { memberId }, (tx) => workspaces.create(tx, Array.from(channel.title).slice(0, 80).join(""))));
    const ciphertext = await encryptToHex(config.tokenKey, refreshToken, workspaceId);
    try {
      await withWorkspace(db, { memberId, workspaceId }, (tx) =>
        youtube.save(tx, { channelId: channel.id, channelTitle: channel.title, tokenCiphertextHex: ciphertext, scopes: tokens.scopes.join(" ") }),
      );
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      await discard();
      return "channel_in_use";
    }
    return null;
  }

  // "undecryptable" still lets deletion proceed: nobody can use that ciphertext, and erasure must not be blocked by a key problem.
  async function revokeWorkspaceToken(c: Ctx, workspaceId: string): Promise<"revoked" | "none" | "undecryptable" | "failed"> {
    const { db, config, memberId } = c.var;
    const ciphertext = await withWorkspace(db, { memberId, workspaceId }, (tx) => youtube.refreshTokenCiphertext(tx));
    if (!ciphertext) return "none";
    let refreshToken: string;
    try {
      refreshToken = await decryptFromHex(config.tokenKey, ciphertext, workspaceId);
    } catch {
      console.error(JSON.stringify({ event: "token_undecryptable" }));
      return "undecryptable";
    }
    try {
      await revokeToken(deps.fetch, refreshToken);
      return "revoked";
    } catch {
      return "failed";
    }
  }

  app.use("*", configured);

  app.get("/google/start", async (c) => {
    const intent = c.req.query("intent") === "moderator" ? "moderator" : "creator";
    const state = randomToken();
    const verifier = randomToken(48);
    const nonce = randomToken();
    await setOAuthCookie(c, c.var.config.sessionKey, { state, verifier, nonce, intent }, nowSeconds());
    const url = buildAuthUrl({
      clientId: c.var.config.clientId,
      redirectUri: redirectUri(c),
      state,
      codeChallenge: await sha256Base64Url(verifier),
      nonce,
      intent,
    });
    return c.redirect(url, 302);
  });

  app.get("/google/callback", async (c) => {
    const { db, config } = c.var;
    const fail = (outcome: SignInOutcome) => c.redirect(`/?signin=${outcome}`, 302);
    const saved = await takeOAuthCookie(c, config.sessionKey, nowSeconds());
    const state = c.req.query("state");
    if (!saved || !state || !safeEqual(state, saved.state)) return fail("state");
    if (c.req.query("error")) return fail("denied");
    const code = c.req.query("code");
    if (!code) return fail("state");

    let tokens: TokenSet;
    let claims;
    try {
      tokens = await exchangeCode(deps.fetch, {
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        code,
        codeVerifier: saved.verifier,
        redirectUri: redirectUri(c),
      });
      claims = verifyIdToken(tokens.idToken, { clientId: config.clientId, nonce: saved.nonce, nowSeconds: nowSeconds() });
    } catch {
      return fail("google");
    }

    const memberId = await withSystem(db, (tx) =>
      members.upsertFromGoogle(tx, { googleSub: claims.sub, email: claims.email, displayName: claims.name }),
    );
    const outcome = saved.intent === "creator" ? await connectCreator(c, memberId, tokens) : null;

    const previous = readSessionCookie(c);
    const previousHash = previous ? await sessionHash(config.sessionKey, previous) : null;
    const sessionToken = randomToken();
    const hash = await sessionHash(config.sessionKey, sessionToken);
    await withSystem(db, async (tx) => {
      if (previousHash) await sessions.delete(tx, previousHash);
      await sessions.create(tx, memberId, hash, SESSION_TTL_SECONDS);
      await sessions.purgeExpired(tx, SESSION_IDLE_SECONDS);
    });
    setSessionCookie(c, sessionToken);
    return c.redirect(outcome ? `/?signin=${outcome}` : "/", 302);
  });

  app.post("/logout", async (c) => {
    const token = readSessionCookie(c);
    if (token) {
      const hash = await sessionHash(c.var.config.sessionKey, token);
      await withSystem(c.var.db, (tx) => sessions.delete(tx, hash));
    }
    clearSessionCookie(c);
    return c.body(null, 204);
  });

  return { app, configured, requireMember, revokeWorkspaceToken };
}

export function memberRoutes(auth: ReturnType<typeof authRoutes>, deps: AppDeps) {
  const app = new Hono<{ Bindings: AppEnv; Variables: Vars }>();
  const guard = [auth.configured, auth.requireMember] as const;

  app.get("/me", ...guard, async (c) => {
    const { db, memberId } = c.var;
    const body = await withMember(db, { memberId }, async (tx) => ({
      member: await members.me(tx),
      workspaces: await workspaces.listMine(tx),
    }));
    if (!body.member) return c.json({ error: "unauthenticated" }, 401);
    return c.json<MeResponse>({ member: body.member, workspaces: body.workspaces });
  });

  app.get("/workspaces/:id", ...guard, async (c) => {
    const { db, memberId } = c.var;
    try {
      const body = await withWorkspace(db, { memberId, workspaceId: c.req.param("id") }, async (tx) => ({
        workspace: await workspaces.current(tx),
        youtube: await youtube.current(tx),
        members: await workspaces.listMembers(tx),
      }));
      if (!body.workspace) return c.json({ error: "not_found" }, 404);
      const yt = body.youtube && { channelId: body.youtube.channelId, channelTitle: body.youtube.channelTitle, connectedAt: body.youtube.connectedAt };
      return c.json<WorkspaceResponse>({ workspace: body.workspace, youtube: yt, members: body.members });
    } catch (error) {
      if (error instanceof ContextError) return c.json({ error: "not_found" }, 404);
      throw error;
    }
  });

  app.post("/workspaces/:id/youtube/disconnect", ...guard, async (c) => {
    const { db, memberId } = c.var;
    const workspaceId = c.req.param("id");
    let current;
    try {
      current = await withWorkspace(db, { memberId, workspaceId }, (tx) => workspaces.current(tx));
    } catch (error) {
      if (error instanceof ContextError) return c.json({ error: "not_found" }, 404);
      throw error;
    }
    if (!current) return c.json({ error: "not_found" }, 404);
    if (current.role !== "owner") return c.json({ error: "forbidden" }, 403);

    const revoked = await auth.revokeWorkspaceToken(c as Ctx, workspaceId);
    if (revoked === "none") return c.json({ error: "not_connected" }, 404);
    if (revoked === "failed") return c.json({ error: "revoke_failed" }, 502);
    await withWorkspace(db, { memberId, workspaceId }, (tx) => youtube.disconnect(tx));
    return c.body(null, 204);
  });

  app.get("/account/export", ...guard, async (c) => {
    const { db, memberId } = c.var;
    const data = await withMember(db, { memberId }, async (tx) => ({
      member: await members.me(tx),
      workspaces: await workspaces.listMineWithDates(tx),
      sessions: await sessions.mine(tx),
    }));
    const owned = data.workspaces.find((w) => w.role === "owner");
    const channel = owned ? await withWorkspace(db, { memberId, workspaceId: owned.id }, (tx) => youtube.current(tx)) : null;
    c.header("Content-Disposition", 'attachment; filename="engagement-tool-export.json"');
    return c.json({
      exportedAt: deps.now().toISOString(),
      member: data.member,
      workspaces: data.workspaces,
      sessions: data.sessions,
      youtube: channel && { channelId: channel.channelId, channelTitle: channel.channelTitle, connectedAt: channel.connectedAt },
    });
  });

  app.delete("/account", ...guard, async (c) => {
    const { db, memberId } = c.var;
    const owned = (await withMember(db, { memberId }, (tx) => workspaces.listMine(tx))).find((w) => w.role === "owner");
    if (owned && (await auth.revokeWorkspaceToken(c as Ctx, owned.id)) === "failed") return c.json({ error: "revoke_failed" }, 502);
    await withMember(db, { memberId }, (tx) => members.deleteMyAccount(tx));
    clearSessionCookie(c);
    return c.body(null, 204);
  });

  return app;
}

