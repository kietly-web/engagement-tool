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
  applied = new Set<string>();
  flushes = 0;
  fail = false;
  failAfterCommit = false;
  gate: Promise<void> | null = null;
  topReads = 0;
  async top(_season: string, limit: number) {
    this.topReads++;
    return [...this.totals.entries()].map(([channelId, points]) => ({ channelId, points })).sort((a, b) => b.points - a.points).slice(0, limit);
  }
  async flushAndTop(_season: string, batchId: string, deltas: [string, { points: number }][], limit: number) {
    if (this.gate) await this.gate;
    if (this.fail) throw new Error("db down");
    if (!this.applied.has(batchId)) {
      this.applied.add(batchId);
      this.flushes++;
      for (const [id, d] of deltas) this.totals.set(id, (this.totals.get(id) ?? 0) + d.points);
    }
    if (this.failAfterCommit) {
      this.failAfterCommit = false;
      throw new Error("ambiguous commit");
    }
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
  engine.start({ workspaceId: "ws", mode, broadcastId: "b", liveChatId: "c", startedBy: "m", seasonId: "s1", seasonName: "Mùa 1", seasonEndsAt: "2026-11-20T00:00:00Z" });

describe("engine points with slow flushes (ET-21)", () => {
  it("starts from season standings and shows unflushed points live, writing to the database only every 10 minutes", async () => {
    const store = new FakeStore();
    store.totals.set(syntheticChannelId(5), 40);
    const source = new Pages();
    const clock = fixedClock("2026-11-08T13:00:00Z");
    const engine = new SessionEngine(new MemoryStorage(), { get: async () => source, invalidate: () => undefined }, clock, { points: () => store });
    await start(engine);
    source.pages.push({ messages: [msg(1, "!join")], nextPageToken: "1", waitMs: 1000 });
    await engine.tick();
    expect(store.flushes).toBe(1);
    source.pages.push({ messages: [msg(2, "!join"), msg(5, "!join")], nextPageToken: "2", waitMs: 1000 });
    clock.advance(60_000);
    await engine.tick();
    expect(store.flushes).toBe(1);
    expect((await engine.status()).leaderboard?.map((e) => e.points)).toEqual([50, 10, 10]);
    clock.advance(10 * 60_000);
    source.pages.push({ messages: [], nextPageToken: "3", waitMs: 1000 });
    await engine.tick();
    expect(store.flushes).toBe(2);
    expect(store.totals.get(syntheticChannelId(5))).toBe(50);
  });
});

describe("ET-21 review regressions", () => {
  it("flushes in the last minute before the season ends instead of dropping points", async () => {
    const store = new FakeStore();
    const source = new Pages();
    const clock = fixedClock("2026-11-19T23:50:00Z");
    const engine = new SessionEngine(new MemoryStorage(), { get: async () => source, invalidate: () => undefined }, clock, { points: () => store });
    await start(engine);
    source.pages.push({ messages: [msg(1, "!join")], nextPageToken: "1", waitMs: 1000 });
    await engine.tick();
    source.pages.push({ messages: [msg(2, "!join")], nextPageToken: "2", waitMs: 1000 });
    clock.advance(9 * 60_000 + 30_000);
    await engine.tick();
    expect(store.totals.get(syntheticChannelId(2))).toBe(10);
  });

  it("keeps and retries points when the final flush at stop fails", async () => {
    const store = new FakeStore();
    const source = new Pages();
    const clock = fixedClock("2026-11-08T13:00:00Z");
    const storage = new MemoryStorage();
    const engine = new SessionEngine(storage, { get: async () => source, invalidate: () => undefined }, clock, { points: () => store });
    await start(engine);
    source.pages.push({ messages: [msg(2, "!join")], nextPageToken: "0", waitMs: 1000 });
    await engine.tick();
    source.pages.push({ messages: [msg(3, "!join")], nextPageToken: "1", waitMs: 1000 });
    clock.advance(1000);
    await engine.tick();
    store.fail = true;
    await engine.stop();
    expect(await storage.get("points")).toBeDefined();
    expect(storage.alarm).not.toBeNull();
    store.fail = false;
    clock.advance(60_000);
    await engine.tick();
    expect(store.totals.get(syntheticChannelId(3))).toBe(10);
    expect(await storage.get("points")).toBeUndefined();
  });

  it("an erased viewer drops off the live leaderboard even with stale standings", async () => {
    const store = new FakeStore();
    store.totals.set(syntheticChannelId(4), 99);
    const source = new Pages();
    const engine = new SessionEngine(new MemoryStorage(), { get: async () => source, invalidate: () => undefined }, fixedClock("2026-11-08T13:00:00Z"), {
      points: () => store,
    });
    await start(engine);
    await engine.tick();
    await engine.eraseViewer(syntheticChannelId(4));
    expect((await engine.status()).leaderboard).toEqual([]);
  });
});

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
    clock.advance(20_000);
    await engine.tick();
    expect(store.totals.get(syntheticChannelId(1))).toBe(10);
  });

  it("never double-counts when a flush commits but the response is lost", async () => {
    const store = new FakeStore();
    store.failAfterCommit = true;
    const { engine, source, clock } = engineWith(store);
    await start(engine);
    source.pages.push({ messages: [msg(1, "!join")], nextPageToken: "1", waitMs: 1000 });
    await engine.tick();
    clock.advance(30_000);
    await engine.tick();
    expect(store.totals.get(syntheticChannelId(1))).toBe(10);
    expect(store.flushes).toBe(1);
  });

  it("an erasure during an in-flight flush sticks: the viewer is never written again", async () => {
    const store = new FakeStore();
    let release!: () => void;
    store.gate = new Promise((r) => (release = r));
    const { engine, source, clock } = engineWith(store);
    await start(engine);
    source.pages.push({ messages: [msg(1, "!join"), msg(2, "!join")], nextPageToken: "1", waitMs: 1000 });
    const ticking = engine.tick();
    await new Promise((r) => setTimeout(r, 0));
    const erasing = engine.eraseViewer(syntheticChannelId(1));
    release();
    await ticking;
    await erasing;
    store.totals.delete(syntheticChannelId(1));
    store.gate = null;
    source.pages.push({ messages: [msg(1, "!join"), msg(1, "!vote 1")], nextPageToken: "2", waitMs: 1000 });
    clock.advance(30_000);
    await engine.tick();
    await engine.stop();
    expect(store.totals.has(syntheticChannelId(1))).toBe(false);
    expect(store.totals.get(syntheticChannelId(2))).toBe(10);
  });

  it("without a season, repeated !join still counts once", async () => {
    const { engine, source } = engineWith(null);
    await engine.start({ workspaceId: "ws", mode: "youtube", broadcastId: "b", liveChatId: "c", startedBy: "m", seasonId: null });
    for (let i = 0; i < 5; i++) {
      source.pages.push({ messages: [msg(1, "!join")], nextPageToken: String(i), waitMs: 1000 });
      await engine.tick();
    }
    expect((await engine.status()).leaderboard).toEqual([{ rank: 1, name: "Khán giả 1", points: 10 }]);
  });

  it("backs off after a failed flush and stops writing points after repeated failures", async () => {
    const store = new FakeStore();
    store.fail = true;
    const { engine, source, clock, storage } = engineWith(store);
    await start(engine);
    let attempts = 0;
    const original = store.flushAndTop.bind(store);
    store.flushAndTop = (...args) => {
      attempts++;
      return original(...args);
    };
    source.pages.push({ messages: [msg(1, "!join")], nextPageToken: "1", waitMs: 1000 });
    await engine.tick();
    await engine.tick();
    expect(attempts).toBe(1);
    for (let i = 0; i < 10; i++) {
      clock.advance(5 * 60_000);
      await engine.tick();
    }
    expect(attempts).toBe(5);
    expect(await storage.get("points")).toBeUndefined();
    expect((await engine.status()).status).toBe("live");
  });

  it("stops writing points once the season has ended mid-session", async () => {
    const store = new FakeStore();
    const { engine, source, clock, storage } = engineWith(store);
    await start(engine);
    clock.advance(12 * 86_400_000);
    source.pages.push({ messages: [msg(1, "!join")], nextPageToken: "1", waitMs: 1000 });
    await engine.tick();
    expect(store.flushes).toBe(0);
    expect(await storage.get("points")).toBeUndefined();
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
    const kept = (await storage.get("points")) as { pending: [string][]; joined: string[]; erased: string[]; inflight: { deltas: [string][] } | null };
    const credited = [...kept.pending.map(([id]) => id), ...kept.joined, ...(kept.inflight?.deltas.map(([id]) => id) ?? [])];
    expect(credited).not.toContain(syntheticChannelId(1));
    expect(kept.erased).toEqual([syntheticChannelId(1)]);
    expect((await engine.status()).leaderboard?.map((e) => e.name)).toEqual(["Khán giả 2"]);
    store.fail = false;
    await engine.stop();
    expect(await storage.get("points")).toBeUndefined();
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
    expect((await b.post(`/api/workspaces/${ws}/seasons`, json({ name: "Mùa 1", days: 30 }))).status).toBe(400);
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
