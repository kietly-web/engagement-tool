import type { MiddlewareHandler } from "hono";

export const API_SECURITY_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  const path = c.req.path;
  // A WebSocket upgrade comes back from the Durable Object with immutable headers; touching them throws.
  if (c.res.status === 101 || (path.startsWith("/o/") && path.endsWith("/ws"))) return;
  const overlayPage = path.startsWith("/o/");
  for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
    // Overlay pages set their own CSP; every other response gets exactly the strict set, whatever a handler sent.
    if (!overlayPage || !c.res.headers.has(name)) c.res.headers.set(name, value);
  }
};
