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
  // Routes that need a different policy (overlay pages) set their own; everything else gets the strict API set.
  for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
    if (!c.res.headers.has(name)) c.res.headers.set(name, value);
  }
};
