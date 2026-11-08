import type { FetchLike } from "@et/youtube";
import { fromBase64Url } from "./crypto";

export const GOOGLE = {
  authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  revokeUrl: "https://oauth2.googleapis.com/revoke",
  issuers: ["https://accounts.google.com", "accounts.google.com"],
  youtubeScope: "https://www.googleapis.com/auth/youtube.readonly",
} as const;

export type Intent = "creator" | "moderator";

export class AuthError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "AuthError";
  }
}

export function buildAuthUrl(p: { clientId: string; redirectUri: string; state: string; codeChallenge: string; nonce: string; intent: Intent }): string {
  const scopes = ["openid", "email", "profile", ...(p.intent === "creator" ? [GOOGLE.youtubeScope] : [])];
  const params = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    state: p.state,
    nonce: p.nonce,
    code_challenge: p.codeChallenge,
    code_challenge_method: "S256",
    include_granted_scopes: "false",
  });
  if (p.intent === "creator") {
    params.set("access_type", "offline");
    params.set("prompt", "consent");
  } else {
    params.set("prompt", "select_account");
  }
  return `${GOOGLE.authUrl}?${params}`;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  idToken: string;
  scopes: string[];
}

export async function exchangeCode(
  fetchFn: FetchLike,
  p: { clientId: string; clientSecret: string; code: string; codeVerifier: string; redirectUri: string },
): Promise<TokenSet> {
  const res = await fetchFn(GOOGLE.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: p.code,
      code_verifier: p.codeVerifier,
      client_id: p.clientId,
      client_secret: p.clientSecret,
      redirect_uri: p.redirectUri,
    }).toString(),
  });
  if (!res.ok) throw new AuthError("token_exchange_failed");
  const body = (await res.json()) as Record<string, unknown>;
  if (typeof body.access_token !== "string" || typeof body.id_token !== "string") throw new AuthError("token_response_invalid");
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null,
    idToken: body.id_token,
    scopes: typeof body.scope === "string" ? body.scope.split(" ").filter(Boolean) : [],
  };
}

export interface IdClaims {
  sub: string;
  email: string;
  name: string;
}

const UNSAFE_NAME_CHARS = /[\p{Cc}\p{Cf}]/gu;

// Signature not checked: the token came straight from Google's token endpoint over TLS with our client
// secret (OIDC Core 3.1.3.7). Never accept an ID token from any other source with this function.
export function verifyIdToken(idToken: string, p: { clientId: string; nonce: string; nowSeconds: number }): IdClaims {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new AuthError("id_token_malformed");
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[1]!)));
  } catch {
    throw new AuthError("id_token_malformed");
  }
  if (!(GOOGLE.issuers as readonly unknown[]).includes(claims.iss)) throw new AuthError("id_token_issuer");
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(p.clientId) || (aud.length > 1 && claims.azp !== p.clientId)) throw new AuthError("id_token_audience");
  if (typeof claims.exp !== "number" || claims.exp <= p.nowSeconds) throw new AuthError("id_token_expired");
  if (typeof claims.nonce !== "string" || claims.nonce !== p.nonce) throw new AuthError("id_token_nonce");
  if (typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 255) throw new AuthError("id_token_subject");
  if (claims.email_verified !== true || typeof claims.email !== "string" || claims.email.length > 320) throw new AuthError("email_unverified");

  const rawName = typeof claims.name === "string" ? claims.name : claims.email.split("@")[0]!;
  const name = Array.from(rawName.normalize("NFC").replace(UNSAFE_NAME_CHARS, "").trim()).slice(0, 100).join("") || "Google user";
  return { sub: claims.sub, email: claims.email, name };
}

export async function revokeToken(fetchFn: FetchLike, token: string): Promise<"revoked" | "already_invalid"> {
  const res = await fetchFn(GOOGLE.revokeUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString(),
  });
  if (res.ok) return "revoked";
  if (res.status === 400) return "already_invalid";
  throw new AuthError("revoke_failed");
}
