import { describe, expect, it } from "vitest";
import { QuotaBudget, quotaDay } from "./quota";

const limits = { projectDaily: 100, workspaceDaily: 40 };

describe("quotaDay", () => {
  it("follows Pacific time, not UTC or Vietnam time", () => {
    expect(quotaDay(new Date("2026-11-08T07:59:00Z"))).toBe("2026-11-07");
    expect(quotaDay(new Date("2026-11-08T08:01:00Z"))).toBe("2026-11-08");
  });
});

describe("QuotaBudget", () => {
  const t = new Date("2026-11-08T12:00:00Z");

  it("enforces the per-workspace and project limits", () => {
    const q = new QuotaBudget(limits);
    expect(q.reserve("a", 40, t)).toEqual({ ok: true });
    expect(q.reserve("a", 1, t)).toEqual({ ok: false, reason: "workspace_limit" });
    expect(q.reserve("b", 40, t)).toEqual({ ok: true });
    expect(q.reserve("c", 25, t)).toEqual({ ok: false, reason: "project_limit" });
    expect(q.usage("a", t)).toMatchObject({ workspaceUsed: 40, projectUsed: 80 });
  });

  it("rejects nonsense reservations", () => {
    const q = new QuotaBudget(limits);
    for (const units of [0, -5, 1.5]) expect(q.reserve("a", units, t)).toEqual({ ok: false, reason: "invalid" });
    expect(q.reserve("", 1, t)).toEqual({ ok: false, reason: "invalid" });
  });

  it("resets on a new Pacific day and survives a snapshot round-trip", () => {
    const q = new QuotaBudget(limits);
    q.reserve("a", 40, t);
    const restored = new QuotaBudget(limits, q.snapshot());
    expect(restored.reserve("a", 1, t).ok).toBe(false);
    expect(restored.reserve("a", 1, new Date("2026-11-09T09:00:00Z")).ok).toBe(true);
  });
});
