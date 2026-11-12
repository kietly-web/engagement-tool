import { describe, expect, it } from "vitest";
import { AlertThrottle, DEFAULT_ALERTS, donationAlert, matchAlertCommand, normaliseTrigger, parseAlertsConfig } from "./alerts";
import { syntheticChannelId } from "./synthetic-chat";

const A = syntheticChannelId(1);
const B = syntheticChannelId(2);

describe("normaliseTrigger", () => {
  it.each([
    ["hi", "hi"],
    ["!Hi", "hi"],
    ["tim", "tim"],
    ["!tìm", "tim"],
    ["ＨＯＩ", "hoi"],
  ])("%j → %j", (raw, key) => expect(normaliseTrigger(raw)).toBe(key));

  it.each(["", "!", "vote", "!bình chọn", "join", "doan", "two words", "x".repeat(21), "<b>", 42, "vote1", "v2", "v0", "vote00", "bc3", "chon5", "tham", "binh"])("rejects %j", (raw) => {
    expect(normaliseTrigger(raw)).toBeNull();
  });
});

describe("parseAlertsConfig", () => {
  it("keeps valid commands, drops invalid and duplicate ones, caps at 20, cleans text", () => {
    const config = parseAlertsConfig({
      commands: [
        { trigger: "hi", text: "  Xin   chào\u202E!  ", sticker: "wave", animation: "bounce" },
        { trigger: "!HI", text: "dup" },
        { trigger: "vote", text: "shadow" },
        { trigger: "fire", text: "", sticker: "fire" },
        { trigger: "tim", text: "Thả tim", sticker: "<script>", animation: "spin" },
        ...Array.from({ length: 30 }, (_, i) => ({ trigger: `c${i}`, text: "x" })),
      ],
      viewerCooldownSeconds: 1,
      globalCooldownSeconds: 999,
    });
    expect(config.commands[0]).toEqual({ trigger: "hi", text: "Xin chào!", sticker: "wave", animation: "bounce" });
    expect(config.commands[1]).toEqual({ trigger: "tim", text: "Thả tim", sticker: "heart", animation: "pop" });
    expect(config.commands).toHaveLength(20);
    expect(config).toMatchObject({ viewerCooldownSeconds: 5, globalCooldownSeconds: 60, showHint: true });
  });

  it("defaults on garbage and caps text length", () => {
    expect(parseAlertsConfig(null)).toEqual(DEFAULT_ALERTS);
    expect(parseAlertsConfig({ commands: [{ trigger: "a", text: "y".repeat(200) }] }).commands[0]!.text).toHaveLength(80);
  });
});

describe("matchAlertCommand", () => {
  const { commands } = parseAlertsConfig({ commands: [{ trigger: "tim", text: "Thả tim" }, { trigger: "hi", text: "Chào" }] });
  it("matches the first word with or without diacritics, in any case", () => {
    expect(matchAlertCommand("!tìm", commands)?.trigger).toBe("tim");
    expect(matchAlertCommand("!TIM cho idol", commands)?.trigger).toBe("tim");
    expect(matchAlertCommand("!hi", commands)?.trigger).toBe("hi");
  });
  it("ignores everything else", () => {
    for (const text of ["tim", "hello !tim", "!timx", "!", ""]) expect(matchAlertCommand(text, commands)).toBeNull();
  });
});

describe("AlertThrottle", () => {
  const config = { viewerCooldownSeconds: 30, globalCooldownSeconds: 3 };
  it("enforces global and per-viewer cooldowns", () => {
    const t = new AlertThrottle();
    expect(t.allow(A, 0, config)).toBe(true);
    expect(t.allow(B, 1000, config)).toBe(false);
    expect(t.allow(B, 3000, config)).toBe(true);
    expect(t.allow(A, 10_000, config)).toBe(false);
    expect(t.allow(A, 30_000, config)).toBe(true);
    expect(t.allow("bad", 100_000, config)).toBe(false);
  });
});

describe("donationAlert", () => {
  const on = { superChats: true, memberships: true, showAmount: true, showComment: true };
  it("shows Super Chats with amount and cleaned comment", () => {
    expect(donationAlert({ kind: "super_chat", amount: "₫50.000", comment: "  Cố lên\u202E!  " }, "Linh", on)).toEqual({
      source: "super_chat",
      title: "Cố lên!",
      name: "Linh",
      sticker: "gift",
      animation: "bounce",
      amount: "₫50.000",
    });
  });
  it("respects the owner's switches", () => {
    expect(donationAlert({ kind: "super_chat", amount: "$5", comment: "hi" }, "A", { ...on, superChats: false })).toBeNull();
    expect(donationAlert({ kind: "membership", amount: null, comment: "" }, "A", { ...on, memberships: false })).toBeNull();
    expect(donationAlert({ kind: "super_chat", amount: "$5", comment: "hi" }, "A", { ...on, showAmount: false, showComment: false })).toEqual({
      source: "super_chat",
      title: "",
      name: "A",
      sticker: "gift",
      animation: "bounce",
    });
  });
});
