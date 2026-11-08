import { describe, expect, it } from "vitest";
import { fixedClock } from "./clock";

describe("fixedClock", () => {
  it("returns the set time and advances on demand", () => {
    const clock = fixedClock("2026-11-08T00:00:00Z");
    expect(clock.now().toISOString()).toBe("2026-11-08T00:00:00.000Z");
    clock.advance(1500);
    expect(clock.now().toISOString()).toBe("2026-11-08T00:00:01.500Z");
  });

  it("returns a fresh Date so callers cannot mutate the clock", () => {
    const clock = fixedClock("2026-11-08T00:00:00Z");
    clock.now().setFullYear(2000);
    expect(clock.now().getUTCFullYear()).toBe(2026);
  });

  it("rejects an invalid time", () => {
    expect(() => fixedClock("not a time")).toThrow(RangeError);
  });
});
