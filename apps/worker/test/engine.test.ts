import { fixedClock, syntheticChannelId } from "@et/core";
import { ChatSourceError, DemoChatSource, type ChatPage, type ChatSource } from "@et/youtube";
import { describe, expect, it } from "vitest";
import { ReconnectRequiredError, SessionEngine, type SessionState, type SourceProvider } from "../src/live/engine";
import { MemoryStorage } from "./memory-storage";

class ScriptedSource implements ChatSource {
  pages: (ChatPage | Error)[] = [];
  calls: (string | undefined)[] = [];
  async findActiveLiveChat() {
    return { broadcastId: "b", liveChatId: "c" };
  }
  async fetchPage(_id: string, pageToken?: string) {
    this.calls.push(pageToken);
    const next = this.pages.shift() ?? { messages: [], nextPageToken: pageToken ?? "", waitMs: 5000 };
    if (next instanceof Error) throw next;
    return next;
  }
}

function setup(source: ChatSource = new ScriptedSource(), flags = { disabled: false }) {
  const storage = new MemoryStorage();
  const clock = fixedClock("2026-11-08T13:00:00Z");
  let invalidations = 0;
  const provider: SourceProvider = { get: async () => source, invalidate: () => void invalidations++ };
  const engine = new SessionEngine(storage, provider, clock, { demoDurationMs: 60_000, maxFailures: 3, disabled: () => flags.disabled });
  return { engine, storage, clock, flags, invalidations: () => invalidations };
}

const msg = (viewer: number, text: string) => ({ channelId: syntheticChannelId(viewer), displayName: `v${viewer}`, text, publishedAt: "" });
const start = (engine: SessionEngine, mode: "youtube" | "demo" = "youtube") =>
  engine.start({ workspaceId: "ws", mode, broadcastId: "b", liveChatId: "c", tokenCiphertext: "01ab" });

describe("SessionEngine lifecycle", () => {
  it("starts once, schedules an immediate tick, and refuses a second start", async () => {
    const { engine, storage, clock } = setup();
    expect((await start(engine)).ok).toBe(true);
    expect(storage.alarm).toBe(clock.now().getTime());
    expect(await start(engine)).toEqual({ ok: false, error: "already_live" });
    expect((await engine.status()).status).toBe("live");
  });

  it("stops, clears the alarm and forgets the token and every YouTube identifier", async () => {
    const { engine, storage } = setup();
    await start(engine);
    await engine.tick();
    const stopped = await engine.stop();
    expect(stopped).toMatchObject({ status: "stopped", stopReason: "manual" });
    expect(storage.alarm).toBeNull();
    const kept = await storage.get<SessionState>("session");
    expect(kept).toMatchObject({ broadcastId: "", liveChatId: "" });
    expect(kept?.tokenCiphertext).toBeUndefined();
    expect(kept?.pageToken).toBeUndefined();
  });

  it("purges all stored state", async () => {
    const { engine, storage } = setup();
    await start(engine);
    await engine.purge();
    expect(storage.data.size).toBe(0);
    expect(storage.alarm).toBeNull();
    expect((await engine.status()).status).toBe("idle");
  });

  it("stops a running session when the kill switch is turned on", async () => {
    const source = new ScriptedSource();
    const { engine, flags } = setup(source);
    await start(engine);
    flags.disabled = true;
    await engine.tick();
    expect(await engine.status()).toMatchObject({ status: "stopped", stopReason: "disabled" });
    expect(source.calls).toEqual([]);
  });

  it("stops instead of staying stuck live when a tick fails unexpectedly", async () => {
    const { engine, storage } = setup();
    await start(engine);
    const realPut = storage.put.bind(storage);
    let fail = true;
    storage.put = async (key, value) => {
      if (fail && key === "session") {
        fail = false;
        throw new Error("storage hiccup");
      }
      return realPut(key, value);
    };
    await engine.tick();
    expect(await engine.status()).toMatchObject({ status: "stopped", stopReason: "internal_error" });
  });

  it("reports idle before anything happens", async () => {
    expect(await setup().engine.status()).toEqual({ status: "idle", messagesSeen: 0, poll: null });
  });
});

describe("SessionEngine polls", () => {
  it("counts votes from chat into the open poll and persists them", async () => {
    const source = new ScriptedSource();
    const { engine, storage, clock } = setup(source);
    await start(engine);
    expect((await engine.createPoll({ question: "Đội nào?", options: ["Đỏ", "Xanh"] })).ok).toBe(true);
    source.pages.push({ messages: [msg(1, "!vote 1"), msg(2, "!bình chọn 2"), msg(1, "!vote 2"), msg(3, "chào"), msg(4, "!vote 9")], nextPageToken: "p2", waitMs: 4000 });
    await engine.tick();
    const status = await engine.status();
    expect(status.poll).toMatchObject({ counts: [1, 1], total: 2, status: "open" });
    expect(status.messagesSeen).toBe(5);
    expect(storage.alarm).toBe(clock.now().getTime() + 4000);
    await engine.tick();
    expect(source.calls).toEqual([undefined, "p2"]);
  });

  it("allows one open poll at a time and only while live", async () => {
    const { engine } = setup();
    expect(await engine.createPoll({ question: "Q?", options: ["a", "b"] })).toEqual({ ok: false, error: "not_live" });
    await start(engine);
    await engine.createPoll({ question: "Q?", options: ["a", "b"] });
    expect(await engine.createPoll({ question: "Q2?", options: ["a", "b"] })).toEqual({ ok: false, error: "poll_open" });
    expect(await engine.createPoll({ question: "", options: ["a"] })).toEqual({ ok: false, error: "poll_open" });
    expect((await engine.closePoll()).ok).toBe(true);
    expect(await engine.closePoll()).toEqual({ ok: false, error: "no_poll" });
    expect(await engine.createPoll({ question: "", options: ["a"] })).toEqual({ ok: false, error: "invalid_poll" });
  });

  it("closing a poll keeps counts but no viewer ids in storage", async () => {
    const source = new ScriptedSource();
    const { engine, storage } = setup(source);
    await start(engine);
    await engine.createPoll({ question: "Q?", options: ["a", "b"] });
    source.pages.push({ messages: [msg(1, "!vote 1")], nextPageToken: "x", waitMs: 1000 });
    await engine.tick();
    await engine.closePoll();
    expect(JSON.stringify([...storage.data.values()])).not.toContain(syntheticChannelId(1));
    expect((await engine.status()).poll).toMatchObject({ counts: [1, 0], status: "closed" });
  });

  it("stopping the session closes an open poll", async () => {
    const { engine } = setup();
    await start(engine);
    await engine.createPoll({ question: "Q?", options: ["a", "b"] });
    expect((await engine.stop()).poll?.status).toBe("closed");
  });

  it("drops a corrupt stored poll instead of crashing", async () => {
    const { engine, storage } = setup();
    await start(engine);
    await storage.put("poll", { status: "open", voteChange: "zzz" });
    expect((await engine.status()).poll).toBeNull();
  });
});

describe("SessionEngine failures", () => {
  it.each([
    [new ChatSourceError("ended"), "broadcast_ended"],
    [new ChatSourceError("quota"), "quota"],
    [new ReconnectRequiredError(), "reconnect_required"],
  ])("stops on %s", async (error, reason) => {
    const source = new ScriptedSource();
    source.pages.push(error);
    const { engine } = setup(source);
    await start(engine);
    await engine.tick();
    expect(await engine.status()).toMatchObject({ status: "stopped", stopReason: reason });
  });

  it("backs off on transient errors and gives up after the limit", async () => {
    const source = new ScriptedSource();
    source.pages.push(new ChatSourceError("unavailable"), new ChatSourceError("rate_limited"), new ChatSourceError("unavailable"));
    const { engine, storage, clock } = setup(source);
    await start(engine);
    await engine.tick();
    expect(storage.alarm).toBe(clock.now().getTime() + 2000);
    await engine.tick();
    expect(storage.alarm).toBe(clock.now().getTime() + 4000);
    await engine.tick();
    expect(await engine.status()).toMatchObject({ status: "stopped", stopReason: "youtube_unavailable" });
  });

  it("drops the cached access token on 401 and keeps going", async () => {
    const source = new ScriptedSource();
    source.pages.push(new ChatSourceError("unauthorized"), { messages: [], nextPageToken: "p", waitMs: 1000 });
    const { engine, invalidations } = setup(source);
    await start(engine);
    const before = invalidations();
    await engine.tick();
    await engine.tick();
    expect(invalidations()).toBe(before + 1);
    expect((await engine.status()).status).toBe("live");
  });

  it("ignores alarms after the session has stopped", async () => {
    const source = new ScriptedSource();
    const { engine } = setup(source);
    await start(engine);
    await engine.stop();
    await engine.tick();
    expect(source.calls).toEqual([]);
  });
});

describe("SessionEngine demo mode", () => {
  it("runs on synthetic chat and finishes on its own", async () => {
    const { engine, clock } = setup(new DemoChatSource(7, 2));
    await start(engine, "demo");
    await engine.createPoll({ question: "Demo?", options: ["Có", "Không"] });
    for (let i = 0; i < 5; i++) await engine.tick();
    expect((await engine.status()).poll?.total).toBeGreaterThan(0);
    clock.advance(60_000);
    await engine.tick();
    expect(await engine.status()).toMatchObject({ status: "stopped", stopReason: "demo_finished" });
  });
});
