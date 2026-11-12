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

describe("alertView donations", () => {
  const defaults = { test: "T", superChat: "SC", membership: "M" };
  it("shows the amount and falls back to a thank-you line when there's no comment", () => {
    expect(alertView({ type: "alert", alert: { source: "super_chat", title: "", name: "Linh", sticker: "gift", animation: "bounce", amount: "₫50.000" } }, defaults)).toMatchObject({
      title: "SC",
      amount: "₫50.000",
      name: "Linh",
    });
    expect(alertView({ type: "alert", alert: { source: "membership", title: "", name: null, sticker: "star", animation: "bounce" } }, defaults)?.title).toBe("M");
    expect(alertView({ type: "alert", alert: { source: "command", title: "", name: null, sticker: "star", animation: "pop" } }, defaults)).toBeNull();
  });
});

describe("hintTriggers", () => {
  it("lists at most six safe triggers only when the hint is on", () => {
    const commands = Array.from({ length: 8 }, (_, i) => ({ trigger: `c${i}`, text: "x", sticker: "heart" as const, animation: "pop" as const }));
    const base = { viewerCooldownSeconds: 30, globalCooldownSeconds: 3, donations: { superChats: true, memberships: true, showAmount: true, showComment: true } };
    expect(hintTriggers({ ...base, commands, showHint: true })).toHaveLength(6);
    expect(hintTriggers({ ...base, commands, showHint: false })).toEqual([]);
    expect(hintTriggers({ ...base, commands: [{ ...commands[0]!, trigger: "<x>" }], showHint: true })).toEqual([]);
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
