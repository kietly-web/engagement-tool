import { Hono } from "hono";
import type { HealthResponse } from "./api-types";
import { securityHeaders } from "./security-headers";

export const app = new Hono<{ Bindings: Env }>();

app.use("*", securityHeaders);

app.get("/healthz", (c) => c.json<HealthResponse>({ ok: true, env: c.env.APP_ENV }));

// Overlay tokens arrive in ET-7; until then no overlay URL resolves.
app.all("/o/*", (c) => c.notFound());

app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));
