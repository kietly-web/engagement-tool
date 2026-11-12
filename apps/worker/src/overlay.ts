import { parseWidgetConfig } from "@et/core";
import { audit, overlays, widgetConfigs, withSystem, withWorkspace, workspaces, ContextError } from "@et/db";
import { Hono, type Context } from "hono";
import type { ObsLinkResponse, OverlayLinkView, OverlayRotateResponse, OverlayWidget } from "./api-types";
import type { authRoutes, Vars } from "./auth";
import { decryptFromHex, encryptToHex, randomToken, toHex } from "./crypto";
import type { AppDeps, AppEnv } from "./env";

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const BUILT_WIDGETS: readonly OverlayWidget[] = ["poll", "leaderboard", "alerts"];
type ConfigurableWidget = "poll" | "leaderboard" | "alerts";
const CONFIGURABLE: readonly ConfigurableWidget[] = ["poll", "leaderboard", "alerts"];
const isConfigurable = (w: string): w is ConfigurableWidget => CONFIGURABLE.includes(w as ConfigurableWidget);
const isBuilt = (w: string): w is OverlayWidget => BUILT_WIDGETS.includes(w as OverlayWidget);
const isPublic = (w: string): w is OverlayWidget => w === "scene" || isBuilt(w);
const sceneAad = (workspaceId: string) => `overlay:${workspaceId}:scene`;

// OBS reads these when a link is dragged onto its window (OBS 25+): https://obsproject.com/tools/browser-drag-and-drop
export function obsDragUrl(url: string): string {
  return `${url}?layer-name=${encodeURIComponent("Engagement Tool")}&layer-width=1920&layer-height=1080`;
}

export const OVERLAY_PAGE_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

// Per-isolate memory of hashes that didn't resolve, so stale OBS sources and scanners don't keep Neon awake.
// Only misses are cached: a hit must always be re-checked so rotation takes effect at once.
const MISS_TTL_MS = 5 * 60_000;
const MISS_MAX = 2_000;
const misses = new Map<string, number>();

function recentlyMissed(hash: string, now: number): boolean {
  const until = misses.get(hash);
  if (until === undefined) return false;
  if (until > now) return true;
  misses.delete(hash);
  return false;
}

function rememberMiss(hash: string, now: number): void {
  if (misses.size >= MISS_MAX) misses.delete(misses.keys().next().value!);
  misses.set(hash, now + MISS_TTL_MS);
}

export function clearOverlayMissCache(): void {
  misses.clear();
}

export async function hashToken(token: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))));
}

// Public, unauthenticated routes: the token in the path is the only credential, and every failure looks the same.
export function overlayPublicRoutes(deps: AppDeps) {
  const app = new Hono<{ Bindings: AppEnv }>();

  async function resolve(c: Context<{ Bindings: AppEnv }>) {
    const token = c.req.param("token") ?? "";
    const widget = c.req.param("widget") ?? "";
    if (!TOKEN.test(token) || !isPublic(widget)) return null;
    const db = deps.database(c.env);
    if (!db) return null;
    const hash = await hashToken(token);
    const now = deps.now().getTime();
    if (recentlyMissed(hash, now)) return null;
    const found = await withSystem(db, (tx) => overlays.resolve(tx, hash));
    if (!found) rememberMiss(hash, now);
    return found && found.widget === widget ? { ...found, hash } : null;
  }

  app.get("/:token/:widget", async (c) => {
    if (!(await resolve(c))) return c.notFound();
    const page = await c.env.ASSETS.fetch(new Request(new URL("/overlay/index.html", c.req.url)));
    if (!page.ok) return c.notFound();
    return new Response(page.body, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", ...OVERLAY_PAGE_HEADERS } });
  });

  app.get("/:token/:widget/ws", async (c) => {
    if (c.req.header("Upgrade") !== "websocket") return c.text("Expected WebSocket", 426);
    const found = await resolve(c);
    if (!found) return c.notFound();
    if (found.widget === "scene") {
      const db = deps.database(c.env)!;
      const saved = await withSystem(db, (tx) => overlays.sceneConfigs(tx, found.hash));
      const configs = Object.fromEntries(CONFIGURABLE.map((w) => [w, parseWidgetConfig(saved[w], w)]));
      return deps.overlaySocket(c.env, found.workspaceId, "scene", c.req.raw, configs);
    }
    return deps.overlaySocket(c.env, found.workspaceId, found.widget, c.req.raw, parseWidgetConfig(found.config, found.widget as ConfigurableWidget));
  });

  return app;
}

export function overlayManageRoutes(auth: ReturnType<typeof authRoutes>, deps: AppDeps) {
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

  app.get("/workspaces/:id/overlays", ...guard, async (c) => {
    const ws = await current(c);
    if (!ws) return c.json({ error: "not_found" }, 404);
    const links = await withWorkspace(c.var.db, { memberId: c.var.memberId, workspaceId: ws.id }, (tx) => overlays.list(tx));
    const body: OverlayLinkView[] = BUILT_WIDGETS.map((widget) => ({ widget, rotatedAt: links.find((l) => l.widget === widget)?.rotatedAt ?? null }));
    return c.json({ overlays: body });
  });

  app.get("/workspaces/:id/widgets/:widget/config", ...guard, async (c) => {
    const ws = await current(c);
    if (!ws) return c.json({ error: "not_found" }, 404);
    const widget = c.req.param("widget");
    if (!isConfigurable(widget)) return c.json({ error: "unknown_widget" }, 400);
    const saved = await withWorkspace(c.var.db, { memberId: c.var.memberId, workspaceId: ws.id }, (tx) => widgetConfigs.get(tx, widget));
    return c.json(parseWidgetConfig(saved, widget));
  });

  app.put("/workspaces/:id/widgets/:widget/config", ...guard, async (c) => {
    const ws = await current(c);
    if (!ws) return c.json({ error: "not_found" }, 404);
    if (ws.role !== "owner") return c.json({ error: "forbidden" }, 403);
    const widget = c.req.param("widget");
    if (!isConfigurable(widget)) return c.json({ error: "unknown_widget" }, 400);
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    // Sections not sent are kept, so the style editor can't wipe alert commands and vice versa.
    const config = await withWorkspace(c.var.db, { memberId: c.var.memberId, workspaceId: ws.id }, async (tx) => {
      const existing = (await widgetConfigs.get(tx, widget)) as Record<string, unknown>;
      const merged = parseWidgetConfig({ ...existing, ...(body && typeof body === "object" ? body : {}) }, widget);
      await widgetConfigs.save(tx, widget, merged);
      return merged;
    });
    try {
      await deps.liveSession(c.env, ws.id).configChanged(widget, config);
    } catch {
      console.error(JSON.stringify({ event: "overlay_config_push_failed" }));
    }
    return c.json(config);
  });

  async function closeScene(env: AppEnv, workspaceId: string): Promise<void> {
    try {
      await deps.liveSession(env, workspaceId).closeOverlays("scene");
    } catch {
      console.error(JSON.stringify({ event: "overlay_close_failed" }));
    }
  }

  async function sceneLink(c: Context<{ Bindings: AppEnv; Variables: Vars }>, workspaceId: string, fresh: boolean): Promise<ObsLinkResponse> {
    const ctx = { memberId: c.var.memberId, workspaceId };
    const key = c.var.config.tokenKey;
    let token: string | null = null;
    let reissued = false;
    if (!fresh) {
      const enc = await withWorkspace(c.var.db, ctx, (tx) => overlays.tokenCiphertext(tx, "scene"));
      if (enc) {
        token = await decryptFromHex(key, enc, sceneAad(workspaceId)).catch(() => null);
        reissued = token === null;
      }
    }
    if (!token) {
      token = randomToken();
      const hash = await hashToken(token);
      const enc = await encryptToHex(key, token, sceneAad(workspaceId));
      await withWorkspace(c.var.db, ctx, async (tx) => {
        await overlays.set(tx, "scene", hash, enc);
        if (fresh || reissued) await audit.log(tx, "overlay_rotated", { widget: "scene", ...(reissued && { reason: "undecryptable" }) });
      });
    }
    if (reissued) {
      // Usually a TOKEN_ENCRYPTION_KEY change: the old link can't be shown again, so it is replaced and its sockets closed.
      console.error(JSON.stringify({ event: "overlay_link_reissued" }));
      await closeScene(c.env, workspaceId);
    }
    const url = `${new URL(c.req.url).origin}/o/${token}/scene`;
    return { url, dragUrl: obsDragUrl(url) };
  }

  app.get("/workspaces/:id/obs-link", ...guard, async (c) => {
    const ws = await current(c);
    if (!ws) return c.json({ error: "not_found" }, 404);
    if (ws.role !== "owner") return c.json({ error: "forbidden" }, 403);
    c.header("Cache-Control", "no-store");
    return c.json(await sceneLink(c, ws.id, false));
  });

  app.post("/workspaces/:id/obs-link/rotate", ...guard, async (c) => {
    const ws = await current(c);
    if (!ws) return c.json({ error: "not_found" }, 404);
    if (ws.role !== "owner") return c.json({ error: "forbidden" }, 403);
    const link = await sceneLink(c, ws.id, true);
    await closeScene(c.env, ws.id);
    c.header("Cache-Control", "no-store");
    return c.json(link);
  });

  app.post("/workspaces/:id/overlays/:widget/rotate", ...guard, async (c) => {
    const ws = await current(c);
    if (!ws) return c.json({ error: "not_found" }, 404);
    if (ws.role !== "owner") return c.json({ error: "forbidden" }, 403);
    const widget = c.req.param("widget");
    if (!isBuilt(widget)) return c.json({ error: "unknown_widget" }, 400);
    const token = randomToken();
    const hash = await hashToken(token);
    await withWorkspace(c.var.db, { memberId: c.var.memberId, workspaceId: ws.id }, async (tx) => {
      await overlays.rotate(tx, widget, hash);
      await audit.log(tx, "overlay_rotated", { widget });
    });
    try {
      await deps.liveSession(c.env, ws.id).closeOverlays(widget);
    } catch {
      console.error(JSON.stringify({ event: "overlay_close_failed" }));
    }
    return c.json<OverlayRotateResponse>({ widget, url: `${new URL(c.req.url).origin}/o/${token}/${widget}` });
  });

  return app;
}
