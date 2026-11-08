import { describe, expect, it } from "vitest";
import { fixedClock } from "./clock";
import { parseCommand } from "./commands";
import { Poll } from "./poll";
import { syntheticChannelId, syntheticChat } from "./synthetic-chat";
import { isChannelId } from "./viewer";

describe("syntheticChat", () => {
  it("is deterministic for a seed", () => {
    expect(syntheticChat({ seed: 7, count: 200 })).toEqual(syntheticChat({ seed: 7, count: 200 }));
    expect(syntheticChat({ seed: 7, count: 200 })).not.toEqual(syntheticChat({ seed: 8, count: 200 }));
  });

  it("uses valid, recognisably synthetic channel ids", () => {
    for (const id of [syntheticChannelId(0), syntheticChannelId(123_456)]) {
      expect(isChannelId(id)).toBe(true);
      expect(id.startsWith("UCSYNTH")).toBe(true);
    }
    expect(syntheticChannelId(1)).not.toBe(syntheticChannelId(2));
  });

  it("produces messages the parser reads exactly as intended, adversarial ones included", () => {
    const messages = syntheticChat({ seed: 42, count: 5_000, adversarial: true });
    const mismatches = messages.filter((m) => JSON.stringify(parseCommand(m.text)) !== JSON.stringify(m.intent));
    expect(mismatches.map((m) => m.text).slice(0, 5)).toEqual([]);
    expect(messages.some((m) => m.intent === null)).toBe(true);
    expect(messages.some((m) => m.intent?.kind === "join")).toBe(true);
  });

  it("drives a poll to the expected first-vote-wins tally", () => {
    const clock = fixedClock("2026-11-08T13:00:00Z");
    const poll = Poll.create({ question: "Đội nào thắng?", options: ["Đỏ", "Xanh", "Vàng"] }, clock);
    poll.open();
    const expected = new Map<string, number>();

    for (const m of syntheticChat({ seed: 3, count: 2_000, viewers: 300, adversarial: true })) {
      const command = parseCommand(m.text);
      if (command?.kind !== "vote") continue;
      poll.vote(m.channelId, command.option);
      if (command.option <= 3 && !expected.has(m.channelId)) expected.set(m.channelId, command.option);
    }

    const counts = [1, 2, 3].map((o) => [...expected.values()].filter((v) => v === o).length);
    expect(poll.results()).toEqual({ counts, total: expected.size });
  });
});
