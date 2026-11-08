import { describe, expect, it } from "vitest";
import { app } from "./app";
import { API_SECURITY_HEADERS } from "./security-headers";

const env = { APP_ENV: "production", ASSETS: { fetch: async () => new Response(null, { status: 404 }) } } as unknown as Env;

describe("worker app", () => {
  it("reports health", async () => {
    const res = await app.request("/healthz", {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, env: "production" });
  });

  it("sets security headers on every response, including 404s", async () => {
    for (const path of ["/healthz", "/api/nope", "/o/sometoken/poll"]) {
      const res = await app.request(path, {}, env);
      for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
        expect(res.headers.get(name), `${path} ${name}`).toBe(value);
      }
    }
  });

  it("resolves no overlay URL before tokens exist", async () => {
    const res = await app.request("/o/anything/poll", {}, env);
    expect(res.status).toBe(404);
  });
});
