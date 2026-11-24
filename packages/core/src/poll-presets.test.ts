import { describe, expect, it } from "vitest";
import { MAX_POLL_PRESETS, parsePollPresets } from "./poll-presets";
import { parseWidgetConfig } from "./widget-config";

describe("parsePollPresets", () => {
  it("keeps valid presets in NFC with tidy spacing", () => {
    const decomposed = "Ti\u0302\u0301p theo cho\u031Bi gi\u0300?";
    expect(parsePollPresets([{ question: `  ${decomposed}  `, options: ["Minecraft", "  Liên   Quân ", "Minecraft"], voteChange: "latest" }])).toEqual([
      { question: decomposed.normalize("NFC"), options: ["Minecraft", "Liên Quân"], voteChange: "latest" },
    ]);
  });

  it("drops presets that couldn't open as a poll", () => {
    expect(
      parsePollPresets([
        { question: "", options: ["a", "b"] },
        { question: "Q", options: ["only one"] },
        { question: "x".repeat(121), options: ["a", "b"] },
        null,
        "nope",
      ]),
    ).toEqual([]);
    expect(parsePollPresets("nope")).toEqual([]);
  });

  it("strips control and invisible characters and caps counts", () => {
    const [p] = parsePollPresets([{ question: "A\u202Eb\u0007", options: ["1", "2", "3", "4", "5", "6", "7"], voteChange: "weird" }]);
    expect(p).toEqual({ question: "Ab", options: ["1", "2", "3", "4", "5", "6"], voteChange: "first" });
    expect(parsePollPresets(Array.from({ length: 20 }, () => ({ question: "Q", options: ["a", "b"] })))).toHaveLength(MAX_POLL_PRESETS);
  });

  it("never reaches the overlay config", () => {
    expect(parseWidgetConfig({ polls: [{ question: "Q", options: ["a", "b"] }] }, "poll")).not.toHaveProperty("polls");
  });
});
