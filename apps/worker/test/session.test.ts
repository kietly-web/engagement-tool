import { describe, expect, it } from "vitest";
import type { MeResponse, SessionResponse } from "../src/api-types";
import { makeHarness, ORIGIN, type Browser, type Harness } from "./harness";

const ID = (n: number) => `UCSYNTHx${String(n).padStart(16, "A")}`;
const chatItem = (viewer: number, text: string) => ({
  snippet: { type: "textMessageEvent", publishedAt: "2026-11-08T12:00:01Z", textMessageDetails: { messageText: text } },
  authorDetails: { channelId: ID(viewer), displayName: `Khán giả ${viewer}`, profileImageUrl: "https://example.test/p.png" },
});

async function creator(h: Harness): Promise<{ b: Browser; ws: string }> {
  const b = h.browser();
  await b.signIn();
  const ws = ((await (await b.request("/api/me")).json()) as MeResponse).workspaces[0]!.id;
  return { b, ws };
}

const json = (body: unknown) => ({ body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const read = async (res: Response) => (await res.json()) as SessionResponse & { error?: string };

describe("demo sessions", () => {
  it("run a poll end to end on synthetic chat", async () => {
    const h = await makeHarness();
    const { b, ws } = await creator(h);
    const started = await b.post(`/api/workspaces/${ws}/session`, json({ mode: "demo" }));
    expect(started.status).toBe(201);
    expect((await read(started)).session).toMatchObject({ status: "live", mode: "demo" });

    const poll = await b.post(`/api/workspaces/${ws}/session/poll`, json({ question: "Chơi gì tiếp?", options: ["A", "B", "C", "D"] }));
    expect(poll.status).toBe(201);
    for (let i = 0; i < 5; i++) await h.engines.get(ws)!.tick();

    const status = await read(await b.request(`/api/workspaces/${ws}/session`));
    expect(status.session.poll?.total).toBeGreaterThan(0);
    expect(status.quota).toMatchObject({ workspaceUsed: 0 });

    expect((await b.post(`/api/workspaces/${ws}/session/poll/close`)).status).toBe(200);
    const stopped = await read(await b.request(`/api/workspaces/${ws}/session`, { method: "DELETE", headers: { Origin: ORIGIN } }));
    expect(stopped.session).toMatchObject({ status: "stopped", stopReason: "manual" });
  });
});

describe("YouTube sessions", () => {
  it("find the live broadcast, read chat into the poll and debit quota", async () => {
    const h = await makeHarness();
    const { b, ws } = await creator(h);
    h.google.live = { broadcastId: "b1", liveChatId: "chat-1" };
    const started = await b.post(`/api/workspaces/${ws}/session`, json({ mode: "youtube" }));
    expect(started.status).toBe(201);
    await b.post(`/api/workspaces/${ws}/session/poll`, json({ question: "Đội nào thắng?", options: ["Đỏ", "Xanh"] }));
    h.google.chatPages.push({
      nextPageToken: "p2",
      pollingIntervalMillis: 3000,
      items: [chatItem(1, "!vote 1"), chatItem(2, "!binh chon 2"), chatItem(3, "!vote 2"), chatItem(1, "!vote 2")],
    });
    await h.engines.get(ws)!.tick();

    const status = await read(await b.request(`/api/workspaces/${ws}/session`));
    expect(status.session.poll).toMatchObject({ counts: [1, 2], total: 3 });
    expect(status.quota.workspaceUsed).toBe(1 + 5);
    expect(h.google.calls.filter((u) => u.includes("liveChat/messages"))).toHaveLength(1);
  });

  it.each([
    ["nothing is live", (h: Harness) => void (h.google.live = null), 409, "not_live"],
    ["Google refuses the refresh token", (h: Harness) => ((h.google.live = { broadcastId: "b", liveChatId: "c" }), (h.google.refreshInvalid = true)), 409, "reconnect_required"],
  ])("refuse to start when %s", async (_l, setup, status, error) => {
    const h = await makeHarness();
    const { b, ws } = await creator(h);
    setup(h);
    const res = await b.post(`/api/workspaces/${ws}/session`, json({ mode: "youtube" }));
    expect(res.status).toBe(status);
    expect((await read(res)).error).toBe(error);
  });

  it("refuse to start without a connected channel", async () => {
    const h = await makeHarness();
    const { b, ws } = await creator(h);
    await b.post(`/api/workspaces/${ws}/youtube/disconnect`);
    expect((await read(await b.post(`/api/workspaces/${ws}/session`, json({ mode: "youtube" })))).error).toBe("not_connected");
  });

  it("refuse to start when the workspace's daily quota is spent", async () => {
    const h = await makeHarness({ quota: { projectDaily: 9000, workspaceDaily: 3 } });
    const { b, ws } = await creator(h);
    h.quota.reserve(ws, 3, h.clock.now);
    h.google.live = { broadcastId: "b", liveChatId: "c" };
    const res = await b.post(`/api/workspaces/${ws}/session`, json({ mode: "youtube" }));
    expect([res.status, (await read(res)).error]).toEqual([429, "quota_exhausted"]);
  });

  it("stop with reason quota when polling would exceed the budget", async () => {
    const h = await makeHarness({ quota: { projectDaily: 9000, workspaceDaily: 6 } });
    const { b, ws } = await creator(h);
    h.google.live = { broadcastId: "b", liveChatId: "c" };
    await b.post(`/api/workspaces/${ws}/session`, json({ mode: "youtube" }));
    await h.engines.get(ws)!.tick();
    await h.engines.get(ws)!.tick();
    expect((await read(await b.request(`/api/workspaces/${ws}/session`))).session).toMatchObject({ status: "stopped", stopReason: "quota" });
  });
});

describe("canonical workspace ids", () => {
  it("maps case variants of a workspace id to the same session", async () => {
    const h = await makeHarness();
    const { b, ws } = await creator(h);
    expect((await b.post(`/api/workspaces/${ws}/session`, json({ mode: "demo" }))).status).toBe(201);
    const upper = await b.post(`/api/workspaces/${ws.toUpperCase()}/session`, json({ mode: "demo" }));
    expect([upper.status, (await read(upper)).error]).toEqual([409, "already_live"]);
    expect([...h.engines.keys()]).toEqual([ws]);
  });

  it("disconnecting through an uppercase id still revokes, deletes and purges the session", async () => {
    const h = await makeHarness();
    const { b, ws } = await creator(h);
    await b.post(`/api/workspaces/${ws}/session`, json({ mode: "demo" }));
    expect((await b.post(`/api/workspaces/${ws.toUpperCase()}/youtube/disconnect`)).status).toBe(204);
    expect(h.google.revoked).toEqual(["rt-g-1"]);
    expect((await h.engines.get(ws)!.status()).status).toBe("idle");
  });
});

describe("demo allowance and quota view", () => {
  it("limits demo starts per day and hides other tenants' usage", async () => {
    const h = await makeHarness({ quota: { projectDaily: 9000, workspaceDaily: 3000, demoStartsDaily: 2 } });
    const { b, ws } = await creator(h);
    for (let i = 0; i < 2; i++) {
      expect((await b.post(`/api/workspaces/${ws}/session`, json({ mode: "demo" }))).status).toBe(201);
      await b.request(`/api/workspaces/${ws}/session`, { method: "DELETE", headers: { Origin: ORIGIN } });
    }
    const third = await b.post(`/api/workspaces/${ws}/session`, json({ mode: "demo" }));
    expect([third.status, (await read(third)).error]).toEqual([429, "demo_limit"]);
    const quota = (await read(await b.request(`/api/workspaces/${ws}/session`))).quota;
    expect(quota).toEqual({ day: expect.any(String), workspaceUsed: 0, workspaceLimit: 3000, projectHeadroomLow: false, demoStartsLeft: 0 });
  });

  it("account deletion purges the owner's session state", async () => {
    const h = await makeHarness();
    const { b, ws } = await creator(h);
    await b.post(`/api/workspaces/${ws}/session`, json({ mode: "demo" }));
    expect((await b.request("/api/account", { method: "DELETE", headers: { Origin: ORIGIN } })).status).toBe(204);
    expect((await h.engines.get(ws)!.status()).status).toBe("idle");
  });
});

describe("access and validation", () => {
  it("lets a moderator run sessions and polls", async () => {
    const h = await makeHarness();
    const { ws } = await creator(h);
    h.google.account = { sub: "g-mod", email: "mod@example.test", scopes: ["openid", "email", "profile"] };
    const mod = h.browser();
    await mod.signIn("moderator");
    await h.db.transaction((tx) =>
      tx.query("INSERT INTO app.workspace_member (workspace_id, member_id, role) SELECT $1, id, 'moderator' FROM app.member WHERE google_sub = 'g-mod'", [ws]),
    );
    expect((await mod.post(`/api/workspaces/${ws}/session`, json({ mode: "demo" }))).status).toBe(201);
    expect((await mod.post(`/api/workspaces/${ws}/session/poll`, json({ question: "Q?", options: ["a", "b"] }))).status).toBe(201);
  });

  it("hides sessions of other workspaces and malformed ids", async () => {
    const h = await makeHarness();
    const { ws } = await creator(h);
    h.google.account = { sub: "g-x", email: "x@example.test", channel: { id: ID(9), title: "X" } };
    const other = h.browser();
    await other.signIn();
    for (const id of [ws, "nope"]) {
      expect((await other.request(`/api/workspaces/${id}/session`)).status).toBe(404);
      expect((await other.post(`/api/workspaces/${id}/session`, json({ mode: "demo" }))).status).toBe(404);
    }
    expect(h.engines.has(ws)).toBe(false);
  });

  it("rejects bad input, double starts, polls while idle and cross-origin posts", async () => {
    const h = await makeHarness();
    const { b, ws } = await creator(h);
    expect((await b.post(`/api/workspaces/${ws}/session`, json({ mode: "bot" }))).status).toBe(400);
    expect((await read(await b.post(`/api/workspaces/${ws}/session/poll`, json({ question: "Q?", options: ["a", "b"] })))).error).toBe("not_live");
    await b.post(`/api/workspaces/${ws}/session`, json({ mode: "demo" }));
    expect((await read(await b.post(`/api/workspaces/${ws}/session`, json({ mode: "demo" })))).error).toBe("already_live");
    expect((await b.post(`/api/workspaces/${ws}/session/poll`, json({ question: "Q?", options: "a,b" }))).status).toBe(400);
    expect((await b.post(`/api/workspaces/${ws}/session/poll`, json({ question: "Q?", options: ["a"] }))).status).toBe(400);
    expect((await b.request(`/api/workspaces/${ws}/session`, { method: "DELETE" })).status).toBe(403);
  });

  it("honours the SESSIONS_DISABLED kill switch", async () => {
    const h = await makeHarness();
    const { b, ws } = await creator(h);
    (h.env as unknown as Record<string, string>).SESSIONS_DISABLED = "true";
    expect((await b.post(`/api/workspaces/${ws}/session`, json({ mode: "demo" }))).status).toBe(503);
  });
});
