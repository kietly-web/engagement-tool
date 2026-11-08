import { describe, expect, it } from "vitest";
import type { MeResponse, WorkspaceResponse } from "../src/api-types";
import { decryptFromHex, importAesKey } from "../src/crypto";
import { GOOGLE } from "../src/google";
import { makeHarness, ORIGIN, type Harness } from "./harness";

async function tokenCipher(h: Harness) {
  const { rows } = await h.db.transaction((tx) =>
    tx.query<{ workspace_id: string; hex: string }>("SELECT workspace_id, encode(refresh_token_enc, 'hex') AS hex FROM app.youtube_connection"),
  );
  return rows;
}

describe("configuration", () => {
  it("fails closed with 503 when secrets or the database are missing", async () => {
    const h = await makeHarness({ configured: false });
    expect((await h.browser().request("/api/auth/google/start")).status).toBe(503);
    expect((await h.browser().request("/api/me")).status).toBe(503);
  });
});

describe("sign-in start", () => {
  it("redirects to Google with PKCE and a signed, short-lived state cookie", async () => {
    const h = await makeHarness();
    const res = await h.browser().request("/api/auth/google/start?intent=creator");
    expect(res.status).toBe(302);
    const url = new URL(res.headers.get("Location")!);
    expect(url.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/auth/google/callback`);
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith("__Host-et_oauth="))!;
    expect(cookie).toMatch(/Max-Age=600/);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
  });
});

describe("creator sign-in", () => {
  it("creates the member, workspace and encrypted YouTube connection, then a session", async () => {
    const h = await makeHarness();
    const b = h.browser();
    expect(await b.signIn()).toBe("/");
    const session = [...b.jar.keys()];
    expect(session).toEqual(["__Host-et_session"]);

    const me = (await (await b.request("/api/me")).json()) as MeResponse;
    expect(me.member.email).toBe("creator@example.test");
    expect(me.workspaces).toEqual([{ id: expect.any(String), name: "Kênh Thử", role: "owner" }]);

    const ws = (await (await b.request(`/api/workspaces/${me.workspaces[0]!.id}`)).json()) as WorkspaceResponse;
    expect(ws.youtube).toMatchObject({ channelId: "UCSYNTHxAAAAAAAAAAAAAAAA", channelTitle: "Kênh Thử" });

    const [row] = await tokenCipher(h);
    expect(row!.hex).not.toContain(Buffer.from("rt-g-1").toString("hex"));
    const key = await importAesKey(h.env.TOKEN_ENCRYPTION_KEY!);
    expect(await decryptFromHex(key, row!.hex, row!.workspace_id)).toBe("rt-g-1");
  });

  it("signing in again reuses the same workspace", async () => {
    const h = await makeHarness();
    await h.browser().signIn();
    await h.browser().signIn();
    const { rows } = await h.db.transaction((tx) => tx.query<{ n: number }>("SELECT count(*)::int AS n FROM app.workspace"));
    expect(rows[0]!.n).toBe(1);
  });

  it.each([
    ["the user refuses YouTube access", { scopes: ["openid", "email", "profile"] }, "youtube_denied", true],
    ["Google returns no refresh token", { refreshToken: null }, "no_refresh_token", false],
    ["the account has no channel", { channel: null }, "no_channel", true],
    ["the YouTube API errors", { channelStatus: 403 }, "youtube_error", true],
  ])("when %s, signs in without a workspace and reports it", async (_l, account, outcome, revokes) => {
    const h = await makeHarness();
    h.google.account = { sub: "g-2", email: "x@example.test", ...account };
    const b = h.browser();
    expect(await b.signIn()).toBe(`/?signin=${outcome}`);
    const me = (await (await b.request("/api/me")).json()) as MeResponse;
    expect(me.workspaces).toEqual([]);
    expect(await tokenCipher(h)).toEqual([]);
    expect(h.google.revoked).toEqual(revokes ? ["rt-g-2"] : []);
  });

  it.each([
    ["YouTube errors", { channelStatus: 500 }, "youtube_error"],
    ["the user unticks YouTube", { scopes: ["openid", "email", "profile"] }, "youtube_denied"],
    ["the channel lookup comes back empty", { channel: null }, "no_channel"],
  ])("a connected creator whose re-sign-in fails because %s keeps the working connection", async (_l, patch, outcome) => {
    const h = await makeHarness();
    await h.browser().signIn();
    h.google.account = { ...h.google.account, ...patch };
    expect(await h.browser().signIn()).toBe(`/?signin=${outcome}`);
    expect(h.google.revoked).toEqual([]);
    expect(await tokenCipher(h)).toHaveLength(1);
  });

  it("refuses a channel already connected to another workspace and revokes the new token", async () => {
    const h = await makeHarness();
    await h.browser().signIn();
    h.google.account = { sub: "g-other", email: "other@example.test" };
    expect(await h.browser().signIn()).toBe("/?signin=channel_in_use");
    expect(h.google.revoked).toEqual(["rt-g-other"]);
    expect(await tokenCipher(h)).toHaveLength(1);
  });
});

describe("moderator sign-in", () => {
  it("asks only for identity and never calls YouTube", async () => {
    const h = await makeHarness();
    h.google.account = { sub: "g-mod", email: "mod@example.test", scopes: ["openid", "email", "profile"] };
    const b = h.browser();
    expect(await b.signIn("moderator")).toBe("/");
    expect(h.google.calls.some((u) => u.includes("youtube"))).toBe(false);
    const me = (await (await b.request("/api/me")).json()) as MeResponse;
    expect(me).toMatchObject({ member: { email: "mod@example.test" }, workspaces: [] });
  });
});

describe("callback rejections", () => {
  async function started(h: Harness) {
    const b = h.browser();
    const start = await b.request("/api/auth/google/start");
    const url = new URL(start.headers.get("Location")!);
    h.google.nonce = url.searchParams.get("nonce")!;
    return { b, state: url.searchParams.get("state")! };
  }
  const noSession = (b: { jar: Map<string, string> }) => expect(b.jar.has("__Host-et_session")).toBe(false);

  it("rejects a wrong state", async () => {
    const h = await makeHarness();
    const { b } = await started(h);
    expect((await b.request("/api/auth/google/callback?state=forged&code=c")).headers.get("Location")).toBe("/?signin=state");
    noSession(b);
  });

  it("rejects a missing or tampered state cookie", async () => {
    const h = await makeHarness();
    const { b, state } = await started(h);
    const original = b.jar.get("__Host-et_oauth")!;
    b.jar.set("__Host-et_oauth", original.replace(/.$/, (ch) => (ch === "0" ? "1" : "0")));
    expect((await b.request(`/api/auth/google/callback?state=${state}&code=c`)).headers.get("Location")).toBe("/?signin=state");
    expect((await h.browser().request(`/api/auth/google/callback?state=${state}&code=c`)).headers.get("Location")).toBe("/?signin=state");
    noSession(b);
  });

  it("rejects an expired state cookie", async () => {
    const h = await makeHarness();
    const { b, state } = await started(h);
    h.clock.now = new Date(h.clock.now.getTime() + 11 * 60_000);
    expect((await b.request(`/api/auth/google/callback?state=${state}&code=c`)).headers.get("Location")).toBe("/?signin=state");
  });

  it("can't replay a callback: the state cookie is single-use", async () => {
    const h = await makeHarness();
    const { b, state } = await started(h);
    const cookie = b.jar.get("__Host-et_oauth")!;
    await b.request(`/api/auth/google/callback?state=${state}&code=c`);
    const replay = h.browser();
    replay.jar.set("__Host-et_oauth", cookie);
    expect(b.jar.has("__Host-et_oauth")).toBe(false);
    const res = await replay.request(`/api/auth/google/callback?state=${state}&code=c`);
    expect(res.headers.getSetCookie().some((c) => c.startsWith("__Host-et_oauth=;") || /__Host-et_oauth=.*Max-Age=0/.test(c))).toBe(true);
  });

  it.each([
    ["the user cancels", (h: Harness) => h, "&error=access_denied", "denied"],
    ["the nonce doesn't match", (h: Harness) => ((h.google.account.nonceOverride = "other"), h), "", "google"],
    ["the email is unverified", (h: Harness) => ((h.google.account.emailVerified = false), h), "", "google"],
  ])("rejects when %s", async (_l, setup, extra, outcome) => {
    const h = setup(await makeHarness());
    const { b, state } = await started(h);
    expect((await b.request(`/api/auth/google/callback?state=${state}&code=c${extra}`)).headers.get("Location")).toBe(`/?signin=${outcome}`);
    noSession(b);
    const { rows } = await h.db.transaction((tx) => tx.query<{ n: number }>("SELECT count(*)::int AS n FROM app.member"));
    expect(rows[0]!.n).toBe(0);
  });
});

describe("sessions", () => {
  it("rejects missing, malformed and unknown session cookies", async () => {
    const h = await makeHarness();
    const b = h.browser();
    expect((await b.request("/api/me")).status).toBe(401);
    b.jar.set("__Host-et_session", "not-a-token");
    expect((await b.request("/api/me")).status).toBe(401);
    b.jar.set("__Host-et_session", "A".repeat(43));
    expect((await b.request("/api/me")).status).toBe(401);
  });

  it("signing in again in the same browser ends the previous session", async () => {
    const h = await makeHarness();
    const b = h.browser();
    await b.signIn();
    const first = b.jar.get("__Host-et_session")!;
    await b.signIn();
    expect(b.jar.get("__Host-et_session")).not.toBe(first);
    const stale = h.browser();
    stale.jar.set("__Host-et_session", first);
    expect((await stale.request("/api/me")).status).toBe(401);
  });

  it("logs out by deleting the server-side session", async () => {
    const h = await makeHarness();
    const b = h.browser();
    await b.signIn();
    const token = b.jar.get("__Host-et_session")!;
    expect((await b.post("/api/auth/logout")).status).toBe(204);
    const stale = h.browser();
    stale.jar.set("__Host-et_session", token);
    expect((await stale.request("/api/me")).status).toBe(401);
  });

  it("blocks state-changing requests from another origin", async () => {
    const h = await makeHarness();
    const b = h.browser();
    await b.signIn();
    for (const origin of [undefined, "https://evil.test"]) {
      const headers: Record<string, string> = origin ? { Origin: origin } : {};
      expect((await b.request("/api/auth/logout", { method: "POST", headers })).status).toBe(403);
      expect((await b.request("/api/account", { method: "DELETE", headers })).status).toBe(403);
    }
    expect((await b.request("/api/me")).status).toBe(200);
  });
});

describe("workspace access", () => {
  it("hides other workspaces and malformed ids behind 404", async () => {
    const h = await makeHarness();
    const a = h.browser();
    await a.signIn();
    const wsA = ((await (await a.request("/api/me")).json()) as MeResponse).workspaces[0]!.id;
    h.google.account = { sub: "g-b", email: "b@example.test", channel: { id: "UCSYNTHxBBBBBBBBBBBBBBBB", title: "Kênh B" } };
    const b = h.browser();
    await b.signIn();
    expect((await b.request(`/api/workspaces/${wsA}`)).status).toBe(404);
    expect((await b.request("/api/workspaces/not-a-uuid")).status).toBe(404);
    expect((await b.post(`/api/workspaces/${wsA}/youtube/disconnect`)).status).toBe(404);
  });
});

describe("disconnect", () => {
  async function creator(h: Harness) {
    const b = h.browser();
    await b.signIn();
    const ws = ((await (await b.request("/api/me")).json()) as MeResponse).workspaces[0]!.id;
    return { b, ws };
  }

  it("revokes the Google token, then deletes the connection", async () => {
    const h = await makeHarness();
    const { b, ws } = await creator(h);
    expect((await b.post(`/api/workspaces/${ws}/youtube/disconnect`)).status).toBe(204);
    expect(h.google.revoked).toEqual(["rt-g-1"]);
    expect(await tokenCipher(h)).toEqual([]);
    expect((await b.post(`/api/workspaces/${ws}/youtube/disconnect`)).status).toBe(404);
  });

  it("keeps the connection and reports 502 when Google can't revoke, so it can be retried", async () => {
    const h = await makeHarness();
    const { b, ws } = await creator(h);
    h.google.revokeStatus = 503;
    expect((await b.post(`/api/workspaces/${ws}/youtube/disconnect`)).status).toBe(502);
    expect(await tokenCipher(h)).toHaveLength(1);
  });

  it("still deletes a connection whose token can't be decrypted (lost or rotated key), without blocking erasure", async () => {
    const h = await makeHarness();
    const { b, ws } = await creator(h);
    await h.db.transaction((tx) => tx.query("UPDATE app.youtube_connection SET refresh_token_enc = decode(repeat('00', 40), 'hex')"));
    expect((await b.post(`/api/workspaces/${ws}/youtube/disconnect`)).status).toBe(204);
    expect(h.google.revoked).toEqual([]);
    expect(await tokenCipher(h)).toEqual([]);
  });

  it("forbids moderators", async () => {
    const h = await makeHarness();
    const { ws } = await creator(h);
    h.google.account = { sub: "g-mod", email: "mod@example.test", scopes: ["openid", "email", "profile"] };
    const mod = h.browser();
    await mod.signIn("moderator");
    await h.db.transaction((tx) =>
      tx.query("INSERT INTO app.workspace_member (workspace_id, member_id, role) SELECT $1, id, 'moderator' FROM app.member WHERE google_sub = 'g-mod'", [ws]),
    );
    const view = (await (await mod.request(`/api/workspaces/${ws}`)).json()) as WorkspaceResponse;
    expect(view.members.find((m) => m.role === "owner")?.email).toBeNull();
    expect((await mod.post(`/api/workspaces/${ws}/youtube/disconnect`)).status).toBe(403);
    expect(h.google.revoked).toEqual([]);
  });
});

describe("account", () => {
  it("exports the member's data without any token", async () => {
    const h = await makeHarness();
    const b = h.browser();
    await b.signIn();
    const res = await b.request("/api/account/export");
    expect(res.headers.get("Content-Disposition")).toMatch(/attachment/);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({
      member: { email: "creator@example.test" },
      workspaces: [{ role: "owner", joinedAt: expect.any(String) }],
      sessions: [{ createdAt: expect.any(String), expiresAt: expect.any(String) }],
      youtube: { channelId: "UCSYNTHxAAAAAAAAAAAAAAAA" },
    });
    expect(text).not.toMatch(/rt-g-1|refresh|token/i);
  });

  it("deletes the account after revoking Google access", async () => {
    const h = await makeHarness();
    const b = h.browser();
    await b.signIn();
    expect((await b.request("/api/account", { method: "DELETE", headers: { Origin: ORIGIN } })).status).toBe(204);
    expect(h.google.revoked).toEqual(["rt-g-1"]);
    expect(b.jar.has("__Host-et_session")).toBe(false);
    const { rows } = await h.db.transaction((tx) =>
      tx.query<{ m: number; w: number; s: number }>(
        "SELECT (SELECT count(*)::int FROM app.member) AS m, (SELECT count(*)::int FROM app.workspace) AS w, (SELECT count(*)::int FROM app.session) AS s",
      ),
    );
    expect(rows[0]).toEqual({ m: 0, w: 0, s: 0 });
  });

  it("does not delete anything if Google can't revoke", async () => {
    const h = await makeHarness();
    const b = h.browser();
    await b.signIn();
    h.google.revokeStatus = 500;
    expect((await b.request("/api/account", { method: "DELETE", headers: { Origin: ORIGIN } })).status).toBe(502);
    expect((await b.request("/api/me")).status).toBe(200);
  });
});

describe("headers", () => {
  it("API responses carry the security headers and never cache", async () => {
    const h = await makeHarness();
    const res = await h.browser().request("/api/me");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
  });

  it("never requests YouTube write scopes", () => {
    expect(GOOGLE.youtubeScope.endsWith(".readonly")).toBe(true);
  });
});
