import { describe, expect, it } from "vitest";
import { backoffMs, leaderboardModel, parseMessage, parseOverlayPath, pollModel, shouldReconnect } from "./model";

const TOKEN = "A".repeat(43);

describe("parseOverlayPath", () => {
  it("accepts only /o/<43-char token>/poll", () => {
    expect(parseOverlayPath(`/o/${TOKEN}/poll`)).toEqual({ token: TOKEN, widget: "poll" });
    expect(parseOverlayPath(`/o/${TOKEN}/poll/`)).toEqual({ token: TOKEN, widget: "poll" });
    expect(parseOverlayPath(`/o/${TOKEN}/leaderboard`)).toEqual({ token: TOKEN, widget: "leaderboard" });
    expect(parseOverlayPath(`/o/${TOKEN}/scene`)).toEqual({ token: TOKEN, widget: "scene" });
    for (const bad of [`/o/short/poll`, `/o/${TOKEN}/admin`, `/o/${TOKEN}/poll/ws`, `/x/${TOKEN}/poll`, `/o/${"<".repeat(43)}/poll`]) {
      expect(parseOverlayPath(bad)).toBeNull();
    }
  });
});

describe("pollModel", () => {
  const message = (poll: object | null) => ({ type: "poll" as const, live: true, poll: poll as never });

  it("turns counts into percentages and labels", () => {
    expect(pollModel(message({ question: "Đội nào?", options: ["Đỏ", "Xanh"], counts: [3, 1], total: 4, status: "open" }))).toEqual({
      question: "Đội nào?",
      rows: [
        { label: "1. Đỏ", count: 3, percent: 75 },
        { label: "2. Xanh", count: 1, percent: 25 },
      ],
      total: 4,
      closed: false,
    });
  });

  it("keeps hostile text as plain text and strips bidi controls", () => {
    const model = pollModel(message({ question: "<img src=x onerror=alert(1)>\u202E", options: ["<b>a</b>", "b"], counts: [0, 0], total: 0, status: "open" }));
    expect(model?.question).toBe("<img src=x onerror=alert(1)>");
    expect(model?.rows[0]!.label).toBe("1. <b>a</b>");
    expect(model?.rows.every((r) => r.percent === 0)).toBe(true);
  });

  it("clamps garbage counts and ignores missing polls", () => {
    expect(pollModel(message({ question: "Q", options: ["a", "b"], counts: [-5, 2.7], total: -1, status: "closed" }))).toMatchObject({
      rows: [{ count: 0 }, { count: 2 }],
      total: 0,
      closed: true,
    });
    expect(pollModel(message(null))).toBeNull();
  });
});

describe("leaderboardModel", () => {
  it("shows ranks, points and safe names; missing names stay null", () => {
    const model = leaderboardModel({
      type: "leaderboard",
      live: true,
      title: "Mùa 1\u202E",
      entries: [
        { rank: 1, name: "<b>Linh</b>", points: 35 },
        { rank: 2, name: null, points: 10.9 },
      ],
    });
    expect(model).toEqual({
      title: "Mùa 1",
      rows: [
        { rank: 1, name: "<b>Linh</b>", points: 35 },
        { rank: 2, name: null, points: 10 },
      ],
    });
  });

  it("caps at ten rows", () => {
    const entries = Array.from({ length: 30 }, (_, i) => ({ rank: i + 1, name: null, points: 30 - i }));
    expect(leaderboardModel({ type: "leaderboard", live: true, title: null, entries })?.rows).toHaveLength(10);
  });
});

describe("parseMessage", () => {
  it("accepts poll messages only and rejects oversized or broken data", () => {
    expect(parseMessage(JSON.stringify({ type: "poll", live: true, poll: null }))).toMatchObject({ type: "poll" });
    expect(parseMessage("{")).toBeNull();
    expect(parseMessage(JSON.stringify({ type: "html", body: "<script>" }))).toBeNull();
    expect(parseMessage("x".repeat(20_000))).toBeNull();
    expect(parseMessage(42)).toBeNull();
  });
});

describe("reconnect policy", () => {
  it("grows, caps at 30 s, then drops to every 10 minutes after repeated failures", () => {
    expect([0, 1, 4, 7, 8, 50].map(backoffMs)).toEqual([1000, 2000, 16000, 30000, 600000, 600000]);
  });

  it("never reconnects a rotated link", () => {
    expect(shouldReconnect(4001)).toBe(false);
    expect(shouldReconnect(1006)).toBe(true);
  });
});
