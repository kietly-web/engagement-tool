import { Hono } from "hono";
import type { HealthResponse } from "./api-types";
import { authRoutes, memberRoutes } from "./auth";
import { defaultDeps, type AppDeps, type AppEnv } from "./env";
import { sessionRoutes } from "./live/routes";
import { overlayManageRoutes, overlayPublicRoutes } from "./overlay";
import { memberManageRoutes } from "./members";
import { seasonRoutes } from "./seasons";
import { securityHeaders } from "./security-headers";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function createApp(overrides: Partial<AppDeps> = {}) {
  const deps: AppDeps = { ...defaultDeps, ...overrides };
  const app = new Hono<{ Bindings: AppEnv }>();

  app.use("*", securityHeaders);

  app.onError((error, c) => {
    console.error(JSON.stringify({ event: "unhandled_error", name: error.name, route: c.req.routePath }));
    return c.json({ error: "internal" }, 500);
  });

  app.get("/healthz", (c) => c.json<HealthResponse>({ ok: true, env: c.env.APP_ENV }));

  app.route("/o", overlayPublicRoutes(deps));
  app.all("/o/*", (c) => c.notFound());

  app.use("/api/*", async (c, next) => {
    if (!SAFE_METHODS.has(c.req.method) && c.req.header("Origin") !== new URL(c.req.url).origin) {
      return c.json({ error: "bad_origin" }, 403);
    }
    await next();
  });

  const auth = authRoutes(deps);
  app.route("/api/auth", auth.app);
  app.route("/api", memberRoutes(auth, deps));
  app.route("/api", sessionRoutes(auth, deps));
  app.route("/api", overlayManageRoutes(auth, deps));
  app.route("/api", seasonRoutes(auth, deps));
  app.route("/api", memberManageRoutes(auth, deps));

  app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));
  return app;
}

export const app = createApp();
