import { overlays, withSystem, withWorkspace, workspaces, ContextError } from "@et/db";
import { Hono, type Context } from "hono";
import type { OverlayLinkView, OverlayRotateResponse, OverlayWidget } from "./api-types";
import type { authRoutes, Vars } from "./auth";
import { randomToken, toHex } from "./crypto";
import type { AppDeps, AppEnv } from "./env";

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const BUILT_WIDGETS: readonly OverlayWidget[] = ["poll"];
const isBuilt = (w: string): w is OverlayWidget => BUILT_WIDGETS.includes(w as OverlayWidget);

export const OVERLAY_PAGE_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
};

export async function hashToken(token: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))));
}

// Public, unauthenticated routes: the token in the path is the only credential, and every failure looks the same.
export function overlayPublicRoutes(deps: AppDeps) {
  const app = new Hono<{ Bindings: AppEnv }>();

  async function resolve(c: Context<{ Bindings: AppEnv }>) {
    const token = c.req.param("token") ?? "";
    const widget = c.req.param("widget") ?? "";
    if (!TOKEN.test(token) || !isBuilt(widget)) return null;
    const db = deps.database(c.env);
    if (!db) return null;
    const found = await withSystem(db, async (tx) => overlays.lookup(tx, await hashToken(token)));
    return found && found.widget === widget ? found : null;
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
    return deps.overlaySocket(c.env, found.workspaceId, found.widget, c.req.raw);
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

  app.post("/workspaces/:id/overlays/:widget/rotate", ...guard, async (c) => {
    const ws = await current(c);
    if (!ws) return c.json({ error: "not_found" }, 404);
    if (ws.role !== "owner") return c.json({ error: "forbidden" }, 403);
    const widget = c.req.param("widget");
    if (!isBuilt(widget)) return c.json({ error: "unknown_widget" }, 400);
    const token = randomToken();
    await withWorkspace(c.var.db, { memberId: c.var.memberId, workspaceId: ws.id }, async (tx) => overlays.rotate(tx, widget, await hashToken(token)));
    await deps.liveSession(c.env, ws.id).closeOverlays(widget);
    return c.json<OverlayRotateResponse>({ widget, url: `${new URL(c.req.url).origin}/o/${token}/${widget}` });
  });

  return app;
}
