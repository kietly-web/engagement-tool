import { describe, expect, it } from "vitest";
import { cleanSeasonName, PointsError, PointsTally, POINTS, seasonWindow } from "./points";
import { syntheticChannelId } from "./synthetic-chat";

const A = syntheticChannelId(1);
const B = syntheticChannelId(2);

describe("seasonWindow", () => {
  it("allows 1 to 30 days", () => {
    const start = new Date("2026-11-08T00:00:00Z");
    expect(seasonWindow(start, 30).endsAt.toISOString()).toBe("2026-12-08T00:00:00.000Z");
    for (const bad of [0, 31, 1.5, -3]) expect(() => seasonWindow(start, bad)).toThrow(new PointsError("season_length"));
  });
});

describe("cleanSeasonName", () => {
  it("normalises and bounds names", () => {
    expect(cleanSeasonName("  Mùa   1 \u202E")).toBe("Mùa 1");
    expect(() => cleanSeasonName("   ")).toThrow(PointsError);
    expect(() => cleanSeasonName("x".repeat(61))).toThrow(PointsError);
  });
});

describe("PointsTally", () => {
  it("awards a join once per session and every counted vote", () => {
    const t = new PointsTally();
    expect(t.join(A)).toBe(true);
    expect(t.join(A)).toBe(false);
    t.countedVote(A);
    t.countedVote(B);
    expect(new Map(t.takePending())).toEqual(
      new Map([
        [A, { points: POINTS.join + POINTS.countedVote, joins: 1, votes: 1 }],
        [B, { points: POINTS.countedVote, joins: 0, votes: 1 }],
      ]),
    );
    expect(t.hasPending()).toBe(false);
    expect(t.join(A)).toBe(false);
  });

  it("ignores invalid viewer ids", () => {
    const t = new PointsTally();
    expect(t.join("<script>")).toBe(false);
    t.countedVote("UC123");
    expect(t.hasPending()).toBe(false);
  });

  it("survives a snapshot round-trip and drops corrupt entries", () => {
    const t = new PointsTally();
    t.join(A);
    const restored = new PointsTally({ ...t.snapshot(), pending: [...t.snapshot().pending, ["bad", { points: 1, joins: 0, votes: 0 }], [B, { points: -5, joins: 0, votes: 0 }]] });
    expect(restored.snapshot()).toEqual(t.snapshot());
    expect(restored.join(A)).toBe(false);
  });

  it("puts back a failed flush and erases a viewer completely", () => {
    const t = new PointsTally();
    t.join(A);
    const taken = t.takePending();
    t.countedVote(A);
    t.restorePending(taken);
    expect(t.snapshot().pending).toEqual([[A, { points: 15, joins: 1, votes: 1 }]]);
    t.erase(A);
    expect(t.snapshot()).toEqual({ pending: [], joined: [] });
    expect(t.join(A)).toBe(true);
  });
});
