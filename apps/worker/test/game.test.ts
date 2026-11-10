import { fixedClock, syntheticChannelId } from "@et/core";
import type { ChatPage, ChatSource } from "@et/youtube";
import { describe, expect, it } from "vitest";
import type { MeResponse, SessionResponse } from "../src/api-types";
import { SessionEngine } from "../src/live/engine";
import { overlayView } from "../src/live/overlay-view";
import { makeHarness } from "./harness";
import { MemoryStorage } from "./memory-storage";

const msg = (viewer: number, text: string) => ({ channelId: syntheticChannelId(viewer), displayName: `Khán giả ${viewer}`, text, publishedAt: "" });

class Pages implements ChatSource {
  pages: ChatPage[] = [];
  async findActiveLiveChat() {
    return { broadcastId: "b", liveChatId: "c" };
  }
  async fetchPage() {
    return this.pages.shift() ?? { messages: [], nextPageToken: "", waitMs: 1000 };
  }
}

function setup() {
  const source = new Pages();
  const engine = new SessionEngine(new MemoryStorage(), { get: async () => source, invalidate: () => undefined }, fixedClock("2026-11-08T13:00:00Z"), {
    random: () => 0.41,
  });
  return { engine, source };
}

describe("guess game in the engine", () => {
  it("hints, picks the first exact guess as winner, awards points and hides the secret until then", async () => {
    const { engine, source } = setup();
    await engine.start({ workspaceId: "ws", mode: "youtube", broadcastId: "b", liveChatId: "c", seasonId: null });
    expect(await engine.createGame({ min: 1, max: 100 })).toMatchObject({ ok: true });
    expect(await engine.createGame({ min: 1, max: 100 })).toEqual({ ok: false, error: "game_open" });

    source.pages.push({ messages: [msg(1, "!doan 10"), msg(2, "!đoán 90")], nextPageToken: "1", waitMs: 1000 });
    await engine.tick();
    let status = await engine.status();
    expect(status.game).toMatchObject({ status: "open", guesses: 2, lastGuess: { value: 90, hint: "lower" }, secret: null });
    expect(JSON.stringify(overlayView("game", status))).not.toContain('"secret":42');

    source.pages.push({ messages: [msg(3, "!guess 42"), msg(1, "!doan 42")], nextPageToken: "2", waitMs: 1000 });
    await engine.tick();
    status = await engine.status();
    expect(status.game).toMatchObject({ status: "won", secret: 42, winnerName: "Khán giả 3" });
    expect(status.leaderboard?.[0]).toEqual({ rank: 1, name: "Khán giả 3", points: 20 });
    expect(overlayView("game", status)).toMatchObject({ type: "game", game: { status: "won", secret: 42 } });
  });

  it("rejects bad ranges and closing when nothing is open; stopping the session closes the game", async () => {
    const { engine } = setup();
    expect(await engine.createGame({ min: 1, max: 100 })).toEqual({ ok: false, error: "not_live" });
    await engine.start({ workspaceId: "ws", mode: "demo", broadcastId: "demo", liveChatId: "demo" });
    expect(await engine.createGame({ min: 1, max: 5 })).toEqual({ ok: false, error: "invalid_game" });
    expect(await engine.closeGame()).toEqual({ ok: false, error: "no_game" });
    await engine.createGame({ min: 1, max: 100 });
    expect((await engine.stop()).game).toMatchObject({ status: "closed", secret: 42 });
  });
});

describe("game routes", () => {
  it("members start and close a game; input is validated", async () => {
    const h = await makeHarness();
    const b = h.browser();
    await b.signIn();
    const ws = ((await (await b.request("/api/me")).json()) as MeResponse).workspaces[0]!.id;
    const json = (body: unknown) => ({ body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
    expect((await b.post(`/api/workspaces/${ws}/session/game`, json({ min: 1, max: 100 }))).status).toBe(409);
    await b.post(`/api/workspaces/${ws}/session`, json({ mode: "demo" }));
    expect((await b.post(`/api/workspaces/${ws}/session/game`, json({ min: "1", max: 100 }))).status).toBe(400);
    const started = (await (await b.post(`/api/workspaces/${ws}/session/game`, json({ min: 1, max: 50 }))).json()) as SessionResponse;
    expect(started.session.game).toMatchObject({ status: "open", min: 1, max: 50, secret: null });
    const closed = (await (await b.post(`/api/workspaces/${ws}/session/game/close`)).json()) as SessionResponse;
    expect(closed.session.game?.status).toBe("closed");
  });
});
