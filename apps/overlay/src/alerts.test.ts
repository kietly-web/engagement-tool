import { describe, expect, it } from "vitest";
import { AlertQueue, alertView, hintTriggers, QUEUE_LIMIT } from "./alerts";

describe("alertView", () => {
  it("maps stickers and animations from fixed sets and keeps text as plain text", () => {
    expect(
      alertView({ type: "alert", alert: { source: "command", title: "<b>Thả tim</b>\u202E", name: "Linh", sticker: "fire", animation: "shake" } }),
    ).toEqual({ emoji: "🔥", title: "<b>Thả tim</b>", name: "Linh", amount: null, animation: "shake" });
    expect(alertView({ type: "alert", alert: { source: "command", title: "x", name: null, sticker: "evil" as never, animation: "spin" as never } })).toMatchObject({
      emoji: "❤\uFE0F",
      animation: "pop",
    });
  });
});

describe("hintTriggers", () => {
  it("lists at most six safe triggers only when the hint is on", () => {
    const commands = Array.from({ length: 8 }, (_, i) => ({ trigger: `c${i}`, text: "x", sticker: "heart" as const, animation: "pop" as const }));
    expect(hintTriggers({ commands, showHint: true, viewerCooldownSeconds: 30, globalCooldownSeconds: 3 })).toHaveLength(6);
    expect(hintTriggers({ commands, showHint: false, viewerCooldownSeconds: 30, globalCooldownSeconds: 3 })).toEqual([]);
    expect(hintTriggers({ commands: [{ ...commands[0]!, trigger: "<x>" }], showHint: true, viewerCooldownSeconds: 30, globalCooldownSeconds: 3 })).toEqual([]);
  });
});

describe("AlertQueue", () => {
  it("drops the oldest beyond the limit", () => {
    const q = new AlertQueue<number>();
    for (let i = 0; i < QUEUE_LIMIT + 3; i++) q.push(i);
    expect(q.size).toBe(QUEUE_LIMIT);
    expect(q.next()).toBe(3);
  });
});
