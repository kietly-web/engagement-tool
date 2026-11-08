import { describe, expect, it } from "vitest";
import { cleanSeasonName, PointsError, PointsTally, POINTS, seasonWindow } from "./points";
import { syntheticChannelId } from "./synthetic-chat";

const A = syntheticChannelId(1);
const B = syntheticChannelId(2);

describe("seasonWindow", () => {
  it("allows 1 to 29 days so cleanup lag stays inside 30", () => {
    const start = new Date("2026-11-08T00:00:00Z");
    expect(seasonWindow(start, 29).endsAt.toISOString()).toBe("2026-12-07T00:00:00.000Z");
    for (const bad of [0, 30, 31, 1.5, -3]) expect(() => seasonWindow(start, bad)).toThrow(new PointsError("season_length"));
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
    expect(new Map(t.beginBatch("b1")!.deltas)).toEqual(
      new Map([
        [A, { points: POINTS.join + POINTS.countedVote, joins: 1, votes: 1 }],
        [B, { points: POINTS.countedVote, joins: 0, votes: 1 }],
      ]),
    );
    t.completeBatch("b1");
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

  it("keeps an unacknowledged batch under the same id until it completes", () => {
    const t = new PointsTally();
    t.join(A);
    const first = t.beginBatch("b1")!;
    t.countedVote(B);
    expect(t.beginBatch("b2")).toEqual(first);
    const restored = new PointsTally(t.snapshot());
    expect(restored.beginBatch("b3")?.id).toBe("b1");
    restored.completeBatch("b1");
    expect(restored.beginBatch("b4")?.deltas).toEqual([[B, { points: 5, joins: 0, votes: 1 }]]);
  });

  it("erasing removes a viewer from pending and in-flight deltas and blocks further points this session", () => {
    const t = new PointsTally();
    t.join(A);
    t.join(B);
    t.beginBatch("b1");
    t.countedVote(A);
    t.erase(A);
    expect(t.snapshot().inflight?.deltas.map(([id]) => id)).toEqual([B]);
    expect(t.snapshot().pending).toEqual([]);
    expect(t.join(A)).toBe(false);
    expect(t.countedVote(A)).toBe(false);
  });
});
