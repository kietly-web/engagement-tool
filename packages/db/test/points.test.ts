import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { maintenance, points, seasons, withSystem, withWorkspace, type Queryable } from "../src/index";
import { buildWorld, type World } from "./fixtures";

let w: World;
beforeAll(async () => {
  w = await buildWorld();
});
afterAll(() => w.db.close());

const V1 = "UCSYNTHxAAAAAAAAAAAAAAA1";
const V2 = "UCSYNTHxAAAAAAAAAAAAAAA2";
const asA = <T>(member: string, fn: (tx: Queryable) => Promise<T>) => withWorkspace(w.db, { memberId: member, workspaceId: w.wsA }, fn);
const asB = <T>(fn: (tx: Queryable) => Promise<T>) => withWorkspace(w.db, { memberId: w.carol, workspaceId: w.wsB }, fn);

let seasonA = "";

describe("seasons", () => {
  it("only the owner starts a season, at most 30 days, one at a time", async () => {
    await expect(asA(w.bob, (tx) => seasons.create(tx, "Mùa 1", 7))).rejects.toThrow(/row-level security/);
    await expect(asA(w.alice, (tx) => seasons.create(tx, "Quá dài", 31))).rejects.toThrow(/check constraint/);
    const created = await asA(w.alice, (tx) => seasons.create(tx, "Mùa 1", 7));
    expect(created?.name).toBe("Mùa 1");
    seasonA = created!.id;
    expect(await asA(w.alice, (tx) => seasons.create(tx, "Mùa 2", 7))).toBeNull();
    expect((await asA(w.bob, (tx) => seasons.active(tx)))?.id).toBe(seasonA);
  });

  it("an owner can end a season early but never extend it", async () => {
    await expect(asA(w.alice, (tx) => tx.query("UPDATE app.season SET ends_at = ends_at + interval '1 day'"))).rejects.toThrow(/row-level security/);
    await expect(asA(w.alice, (tx) => tx.query("UPDATE app.season SET name = 'x'"))).rejects.toThrow(/permission denied/);
  });
});

describe("viewer points", () => {
  it("flushes deltas additively for members of the workspace", async () => {
    await asA(w.bob, (tx) => points.flush(tx, seasonA, [[V1, { points: 10, joins: 1, votes: 0 }]]));
    await asA(w.bob, (tx) => points.flush(tx, seasonA, [[V1, { points: 5, joins: 0, votes: 1 }], [V2, { points: 5, joins: 0, votes: 1 }]]));
    expect(await asA(w.alice, (tx) => points.top(tx, seasonA, 10))).toEqual([
      { channelId: V1, points: 15, joins: 1, votes: 1 },
      { channelId: V2, points: 5, joins: 0, votes: 1 },
    ]);
  });

  it("other workspaces can neither read nor write them", async () => {
    expect(await asB((tx) => points.top(tx, seasonA, 10))).toEqual([]);
    await expect(asB((tx) => points.flush(tx, seasonA, [[V1, { points: 99, joins: 0, votes: 0 }]]))).rejects.toThrow();
    expect(await withWorkspace(w.db, { memberId: w.dave, workspaceId: w.wsA }, (tx) => points.top(tx, seasonA, 10))).toEqual([]);
  });

  it("rejects invalid channel ids and negative totals", async () => {
    await expect(asA(w.alice, (tx) => points.flush(tx, seasonA, [["<script>", { points: 1, joins: 0, votes: 0 }]]))).rejects.toThrow(/check constraint/);
    await expect(asA(w.alice, (tx) => points.flush(tx, seasonA, [[V2, { points: -50, joins: 0, votes: 0 }]]))).rejects.toThrow(/check constraint/);
  });

  it("only the owner erases a viewer", async () => {
    expect(await asA(w.bob, (tx) => points.eraseViewer(tx, V2))).toBe(0);
    expect(await asA(w.alice, (tx) => points.eraseViewer(tx, V2))).toBe(1);
    expect((await asA(w.alice, (tx) => points.top(tx, seasonA, 10))).map((r) => r.channelId)).toEqual([V1]);
  });

  it("no points can be written into an ended season", async () => {
    expect(await asA(w.alice, (tx) => seasons.endActive(tx))).toBe(true);
    await expect(asA(w.bob, (tx) => points.flush(tx, seasonA, [[V1, { points: 1, joins: 0, votes: 0 }]]))).rejects.toThrow(/row-level security/);
  });
});

describe("daily maintenance", () => {
  it("deletes viewer rows of ended seasons, keeps the season record and writes a heartbeat", async () => {
    const deleted = await withSystem(w.db, (tx) => maintenance.run(tx, 7 * 86_400));
    expect(deleted).toBe(1);
    const { rows } = await w.db.transaction((tx) => tx.query<{ n: number }>("SELECT count(*)::int AS n FROM app.viewer_points"));
    expect(rows[0]!.n).toBe(0);
    expect(await asA(w.alice, (tx) => seasons.recent(tx))).toHaveLength(1);
    expect(await withSystem(w.db, (tx) => maintenance.lastRun(tx))).not.toBeNull();
  });
});
