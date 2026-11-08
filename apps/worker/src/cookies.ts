import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { fromBase64Url, hmacHex, hmacVerify, toBase64Url } from "./crypto";
import type { Intent } from "./google";

export const SESSION_COOKIE = "__Host-et_session";
export const OAUTH_COOKIE = "__Host-et_oauth";
export const SESSION_TTL_SECONDS = 30 * 24 * 3600;
export const SESSION_IDLE_SECONDS = 7 * 24 * 3600;
const OAUTH_TTL_SECONDS = 600;

const base = { path: "/", secure: true, httpOnly: true, sameSite: "Lax" } as const;

export interface OAuthState {
  state: string;
  verifier: string;
  nonce: string;
  intent: Intent;
  expiresAt: number;
}

export async function setOAuthCookie(c: Context, key: CryptoKey, s: Omit<OAuthState, "expiresAt">, nowSeconds: number): Promise<void> {
  const payload = toBase64Url(new TextEncoder().encode(JSON.stringify({ ...s, expiresAt: nowSeconds + OAUTH_TTL_SECONDS })));
  setCookie(c, OAUTH_COOKIE, `${payload}.${await hmacHex(key, `oauth:${payload}`)}`, { ...base, maxAge: OAUTH_TTL_SECONDS });
}

export async function takeOAuthCookie(c: Context, key: CryptoKey, nowSeconds: number): Promise<OAuthState | null> {
  const raw = getCookie(c, OAUTH_COOKIE);
  deleteCookie(c, OAUTH_COOKIE, base);
  if (!raw) return null;
  const [payload, sig] = raw.split(".");
  if (!payload || !sig || !(await hmacVerify(key, `oauth:${payload}`, sig))) return null;
  try {
    const s = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as OAuthState;
    if (typeof s.expiresAt !== "number" || s.expiresAt <= nowSeconds) return null;
    if (s.intent !== "creator" && s.intent !== "moderator") return null;
    return s;
  } catch {
    return null;
  }
}

export function setSessionCookie(c: Context, token: string): void {
  setCookie(c, SESSION_COOKIE, token, { ...base, maxAge: SESSION_TTL_SECONDS });
}

export function readSessionCookie(c: Context): string | undefined {
  const value = getCookie(c, SESSION_COOKIE);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, base);
}

export function sessionHash(key: CryptoKey, token: string): Promise<string> {
  return hmacHex(key, `session:${token}`);
}
