import { describe, expect, it } from "vitest";
import { toBase64Url } from "./crypto";
import { AuthError, buildAuthUrl, exchangeCode, GOOGLE, InvalidGrantError, refreshAccessToken, revokeToken, verifyIdToken } from "./google";

const enc = (o: unknown) => toBase64Url(new TextEncoder().encode(JSON.stringify(o)));
export const fakeIdToken = (claims: Record<string, unknown>) => `${enc({ alg: "RS256" })}.${enc(claims)}.sig`;

const NOW = 1_800_000_000;
const good = { iss: "https://accounts.google.com", aud: "client-1", exp: NOW + 300, nonce: "n1", sub: "123", email: "a@example.test", email_verified: true, name: "Anh" };
const verify = (claims: Record<string, unknown>) => verifyIdToken(fakeIdToken(claims), { clientId: "client-1", nonce: "n1", nowSeconds: NOW });

describe("buildAuthUrl", () => {
  it("asks creators for read-only YouTube with offline access and PKCE", () => {
    const url = new URL(buildAuthUrl({ clientId: "c", redirectUri: "https://x.test/cb", state: "s", codeChallenge: "ch", nonce: "n", intent: "creator" }));
    expect(url.origin + url.pathname).toBe(GOOGLE.authUrl);
    expect(url.searchParams.get("scope")).toBe(`openid email profile ${GOOGLE.youtubeScope}`);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ access_type: "offline", prompt: "consent", code_challenge_method: "S256", state: "s", nonce: "n" });
  });

  it("asks moderators only for identity", () => {
    const url = new URL(buildAuthUrl({ clientId: "c", redirectUri: "r", state: "s", codeChallenge: "ch", nonce: "n", intent: "moderator" }));
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.has("access_type")).toBe(false);
  });

  it("never requests a scope that can write to YouTube", () => {
    for (const intent of ["creator", "moderator"] as const) {
      const scope = new URL(buildAuthUrl({ clientId: "c", redirectUri: "r", state: "s", codeChallenge: "c", nonce: "n", intent })).searchParams.get("scope")!;
      for (const s of scope.split(" ")) expect(["openid", "email", "profile", GOOGLE.youtubeScope]).toContain(s);
    }
  });
});

describe("verifyIdToken", () => {
  it("accepts a valid token and cleans the name", () => {
    expect(verify({ ...good, name: "  An\u202Eh\u0000 " })).toEqual({ sub: "123", email: "a@example.test", name: "Anh" });
  });

  it.each([
    ["issuer", { iss: "https://evil.test" }, "id_token_issuer"],
    ["audience", { aud: "other" }, "id_token_audience"],
    ["multi-audience without azp", { aud: ["client-1", "other"] }, "id_token_audience"],
    ["expired", { exp: NOW }, "id_token_expired"],
    ["nonce", { nonce: "replayed" }, "id_token_nonce"],
    ["missing nonce", { nonce: undefined }, "id_token_nonce"],
    ["unverified email", { email_verified: false }, "email_unverified"],
    ["string email_verified", { email_verified: "true" }, "email_unverified"],
    ["missing sub", { sub: "" }, "id_token_subject"],
  ])("rejects a bad %s", (_l, patch, code) => {
    expect(() => verify({ ...good, ...patch })).toThrow(new AuthError(code));
  });

  it("rejects malformed tokens", () => {
    expect(() => verifyIdToken("abc", { clientId: "c", nonce: "n", nowSeconds: NOW })).toThrow(new AuthError("id_token_malformed"));
    expect(() => verifyIdToken("a.!!!.c", { clientId: "c", nonce: "n", nowSeconds: NOW })).toThrow(new AuthError("id_token_malformed"));
  });
});

describe("token endpoint calls", () => {
  it("exchanges a code with the PKCE verifier and parses granted scopes", async () => {
    let sent = "";
    const tokens = await exchangeCode(
      async (_url, init) => {
        sent = init?.body ?? "";
        return { ok: true, status: 200, json: async () => ({ access_token: "at", refresh_token: "rt", id_token: "it", scope: "openid email" }) };
      },
      { clientId: "c", clientSecret: "s", code: "code", codeVerifier: "v", redirectUri: "r" },
    );
    expect(Object.fromEntries(new URLSearchParams(sent))).toMatchObject({ grant_type: "authorization_code", code: "code", code_verifier: "v" });
    expect(tokens).toEqual({ accessToken: "at", refreshToken: "rt", idToken: "it", scopes: ["openid", "email"] });
  });

  it("asks for reconnection only on invalid_grant, not on our own misconfiguration", async () => {
    const respond = (body: unknown) => async () => ({ ok: false, status: 400, json: async () => body });
    const p = { clientId: "c", clientSecret: "s", refreshToken: "r" };
    await expect(refreshAccessToken(respond({ error: "invalid_grant" }), p)).rejects.toBeInstanceOf(InvalidGrantError);
    await expect(refreshAccessToken(respond({ error: "invalid_client" }), p)).rejects.toEqual(new AuthError("refresh_failed"));
  });

  it("treats 400 on revoke as already invalid and 5xx as failure", async () => {
    expect(await revokeToken(async () => ({ ok: true, status: 200, json: async () => ({}) }), "t")).toBe("revoked");
    expect(await revokeToken(async () => ({ ok: false, status: 400, json: async () => ({}) }), "t")).toBe("already_invalid");
    await expect(revokeToken(async () => ({ ok: false, status: 503, json: async () => ({}) }), "t")).rejects.toThrow(AuthError);
  });
});
