import { fixedClock, syntheticChannelId } from "@et/core";
import type { ChatPage, ChatSource } from "@et/youtube";
import { describe, expect, it } from "vitest";
import type { MeResponse, SessionResponse } from "../src/api-types";
import { SessionEngine } from "../src/live/engine";
import type { PointsStore } from "../src/live/points-store";
import { runDailyMaintenance } from "../src/maintenance";
import type { LeaderboardRow, SeasonsResponse } from "../src/seasons";
import { makeHarness, ORIGIN, type Harness } from "./harness";
import { MemoryStorage } from "./memory-storage";

const msg = (viewer: number, text: string, name = `Khán giả ${viewer}`) => ({ channelId: syntheticChannelId(viewer), displayName: name, text, publishedAt: "" });

class Pages implements ChatSource {
  pages: ChatPage[] = [];
  async findActiveLiveChat() {
    return { broadcastId: "b", liveChatId: "c" };
  }
  async fetchPage() {
    return this.pages.shift() ?? { messages: [], nextPageToken: "", waitMs: 1000 };
  }
}

class FakeStore implements PointsStore {
  totals = new Map<string, number>();
  flushes = 0;
  fail = false;
  async flush(_season: string, deltas: [string, { points: number }][]) {
    if (this.fail) throw new Error("db down");
    this.flushes++;
    for (const [id, d] of deltas) this.totals.set(id, (this.totals.get(id) ?? 0) + d.points);
  }
  async top(_season: string, limit: number) {
    return [...this.totals.entries()].map(([channelId, points]) => ({ channelId, points })).sort((a, b) => b.points - a.points).slice(0, limit);
  }
}

function engineWith(store: FakeStore | null) {
  const source = new Pages();
  const clock = fixedClock("2026-11-08T13:00:00Z");
  const storage = new MemoryStorage();
  const engine = new SessionEngine(storage, { get: async () => source, invalidate: () => undefined }, clock, {
    points: () => store,
    flushEveryMs: 10_000,
  });
  return { engine, source, clock, storage };
}

const start = (engine: SessionEngine, mode: "youtube" | "demo" = "youtube") =>
  engine.start({ workspaceId: "ws", mode, broadcastId: "b", liveChatId: "c", startedBy: "m", seasonId: "s1", seasonName: "Mùa 1" });

describe("engine points", () => {
  it("awards joins once and counted votes, flushes every 10 s and builds the leaderboard with session-only names", async () => {
    const store = new FakeStore();
    const { engine, source, clock } = engineWith(store);
    await start(engine);
    await engine.createPoll({ question: "Q?", options: ["a", "b"] });
    source.pages.push({ messages: [msg(1, "!join"), msg(1, "!join"), msg(1, "!vote 1"), msg(2, "!vote 2"), msg(2, "!vote 1")], nextPageToken: "1", waitMs: 1000 });
    await engine.tick();
    expect(store.flushes).toBe(1);
    expect(store.totals.get(syntheticChannelId(1))).toBe(15);
    expect(store.totals.get(syntheticChannelId(2))).toBe(5);

    source.pages.push({ messages: [msg(3, "!tham gia")], nextPageToken: "2", waitMs: 1000 });
    await engine.tick();
    expect(store.flushes).toBe(1);
    clock.advance(10_000);
    await engine.tick();
    expect(store.flushes).toBe(2);

    const status = await engine.status();
    expect(status.season).toBe("Mùa 1");
    expect(status.leaderboard).toEqual([
      { rank: 1, name: "Khán giả 1", points: 15 },
      { rank: 2, name: "Khán giả 3", points: 10 },
      { rank: 3, name: "Khán giả 2", points: 5 },
    ]);
    const stopped = await engine.stop();
    expect(stopped.leaderboard?.[0]?.name).toBe("Khán giả 1");
    expect((await engine.status()).leaderboard?.[0]?.name).toBeNull();
  });

  it("keeps points pending when the database fails and retries later", async () => {
    const store = new FakeStore();
    store.fail = true;
    const { engine, source, clock, storage } = engineWith(store);
    await start(engine);
    source.pages.push({ messages: [msg(1, "!join")], nextPageToken: "1", waitMs: 1000 });
    await engine.tick();
    expect(JSON.stringify(await storage.get("points"))).toContain(syntheticChannelId(1));
    store.fail = false;
    clock.advance(10_000);
    await engine.tick();
    expect(store.totals.get(syntheticChannelId(1))).toBe(10);
  });

  it("demo mode never writes to the real season but still previews a leaderboard", async () => {
    const store = new FakeStore();
    const { engine, source } = engineWith(store);
    await start(engine, "demo");
    source.pages.push({ messages: [msg(1, "!join"), msg(2, "!join")], nextPageToken: "1", waitMs: 1000 });
    await engine.tick();
    expect(store.flushes).toBe(0);
    const status = await engine.status();
    expect(status.season).toBeNull();
    expect(status.leaderboard).toHaveLength(2);
  });

  it("erasing a viewer removes them from pending points, names and the leaderboard", async () => {
    const store = new FakeStore();
    const { engine, source, storage } = engineWith(store);
    await start(engine);
    store.fail = true;
    source.pages.push({ messages: [msg(1, "!join"), msg(2, "!join")], nextPageToken: "1", waitMs: 1000 });
    await engine.tick();
    await engine.eraseViewer(syntheticChannelId(1));
    expect(JSON.stringify(await storage.get("points"))).not.toContain(syntheticChannelId(1));
    expect((await engine.status()).leaderboard?.map((e) => e.name)).toEqual(["Khán giả 2"]);
  });
});

async function owner(h: Harness) {
  const b = h.browser();
  await b.signIn();
  const ws = ((await (await b.request("/api/me")).json()) as MeResponse).workspaces[0]!.id;
  return { b, ws };
}
const json = (body: unknown) => ({ body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

describe("season and leaderboard routes", () => {
  it("runs a season end to end: create, earn points live, leaderboard, erase a viewer, end, purge", async () => {
    const h = await makeHarness();
    const { b, ws } = await owner(h);
    expect((await b.post(`/api/workspaces/${ws}/seasons`, json({ name: "Mùa 1", days: 31 }))).status).toBe(400);
    expect((await b.post(`/api/workspaces/${ws}/seasons`, json({ name: "Mùa 1", days: 14 }))).status).toBe(201);
    expect((await b.post(`/api/workspaces/${ws}/seasons`, json({ name: "Mùa 2", days: 14 }))).status).toBe(409);

    h.google.live = { broadcastId: "b1", liveChatId: "chat-1" };
    await b.post(`/api/workspaces/${ws}/session`, json({ mode: "youtube" }));
    const item = (v: number, text: string) => ({
      snippet: { type: "textMessageEvent", textMessageDetails: { messageText: text } },
      authorDetails: { channelId: syntheticChannelId(v), displayName: `Người xem ${v}` },
    });
    h.google.chatPages.push({ items: [item(1, "!join"), item(2, "!join"), item(2, "!thamgia")], nextPageToken: "p", pollingIntervalMillis: 3000 });
    h.clock.now = new Date(h.clock.now.getTime() + 1000);
    await h.engines.get(ws)!.tick();

    const session = (await (await b.request(`/api/workspaces/${ws}/session`)).json()) as SessionResponse;
    expect(session.session.leaderboard?.map((e) => e.points)).toEqual([10, 10]);
    const board = (await (await b.request(`/api/workspaces/${ws}/leaderboard`)).json()) as { entries: LeaderboardRow[] };
    expect(board.entries.map((e) => e.channelId).sort()).toEqual([syntheticChannelId(1), syntheticChannelId(2)].sort());

    const erased = await b.request(`/api/workspaces/${ws}/viewers/${syntheticChannelId(1)}`, { method: "DELETE", headers: { Origin: ORIGIN } });
    expect(await erased.json()).toEqual({ removedRows: 1 });
    expect(((await (await b.request(`/api/workspaces/${ws}/leaderboard`)).json()) as { entries: LeaderboardRow[] }).entries).toHaveLength(1);

    expect((await b.post(`/api/workspaces/${ws}/seasons/end`)).status).toBe(204);
    expect(await runDailyMaintenance(h.env, { database: () => h.db })).toBe(1);
    const seasons = (await (await b.request(`/api/workspaces/${ws}/seasons`)).json()) as SeasonsResponse;
    expect(seasons.active).toBeNull();
    expect(seasons.recent).toHaveLength(1);
  });

  it("moderators see the leaderboard without channel ids and can't manage seasons or erase", async () => {
    const h = await makeHarness();
    const { b, ws } = await owner(h);
    await b.post(`/api/workspaces/${ws}/seasons`, json({ name: "Mùa 1", days: 7 }));
    h.google.account = { sub: "g-mod", email: "mod@example.test", scopes: ["openid", "email", "profile"] };
    const mod = h.browser();
    await mod.signIn("moderator");
    await h.db.transaction((tx) =>
      tx.query("INSERT INTO app.workspace_member (workspace_id, member_id, role) SELECT $1, id, 'moderator' FROM app.member WHERE google_sub = 'g-mod'", [ws]),
    );
    await mod.post(`/api/workspaces/${ws}/session`, json({ mode: "demo" }));
    expect((await mod.post(`/api/workspaces/${ws}/seasons/end`)).status).toBe(403);
    expect((await mod.post(`/api/workspaces/${ws}/seasons`, json({ name: "x", days: 3 }))).status).toBe(403);
    expect((await mod.request(`/api/workspaces/${ws}/viewers/${syntheticChannelId(1)}`, { method: "DELETE", headers: { Origin: ORIGIN } })).status).toBe(403);
    const board = await (await mod.request(`/api/workspaces/${ws}/leaderboard`)).json();
    expect(JSON.stringify(board)).not.toContain("UC");
  });

  it("validates erase input and hides other workspaces", async () => {
    const h = await makeHarness();
    const { b, ws } = await owner(h);
    expect((await b.request(`/api/workspaces/${ws}/viewers/not-a-channel`, { method: "DELETE", headers: { Origin: ORIGIN } })).status).toBe(400);
    h.google.account = { sub: "g-x", email: "x@example.test", channel: { id: "UCSYNTHxXXXXXXXXXXXXXXXX", title: "X" } };
    const other = h.browser();
    await other.signIn();
    expect((await other.request(`/api/workspaces/${ws}/leaderboard`)).status).toBe(404);
    expect((await other.request(`/api/workspaces/${ws}/seasons`)).status).toBe(404);
  });
});
