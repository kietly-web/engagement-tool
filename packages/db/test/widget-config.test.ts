import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { overlays, withSystem, withWorkspace, widgetConfigs } from "../src/index";
import { buildWorld, type World } from "./fixtures";

let w: World;
beforeAll(async () => {
  w = await buildWorld();
});
afterAll(() => w.db.close());

const asA = (member: string) => ({ memberId: member, workspaceId: w.wsA });

describe("widget config", () => {
  it("only the owner saves; members read; other workspaces see defaults", async () => {
    await expect(withWorkspace(w.db, asA(w.bob), (tx) => widgetConfigs.save(tx, "poll", { theme: { preset: "neon" } }))).rejects.toThrow(/row-level security/);
    await withWorkspace(w.db, asA(w.alice), (tx) => widgetConfigs.save(tx, "poll", { theme: { preset: "neon" } }));
    await withWorkspace(w.db, asA(w.alice), (tx) => widgetConfigs.save(tx, "poll", { theme: { preset: "day" } }));
    expect(await withWorkspace(w.db, asA(w.bob), (tx) => widgetConfigs.get(tx, "poll"))).toEqual({ theme: { preset: "day" } });
    expect(await withWorkspace(w.db, { memberId: w.carol, workspaceId: w.wsB }, (tx) => widgetConfigs.get(tx, "poll"))).toEqual({});
    expect(await withWorkspace(w.db, { memberId: w.alice, workspaceId: w.wsB }, (tx) => widgetConfigs.get(tx, "poll"))).toEqual({});
  });

  it("rejects oversized or non-object configs and unknown widgets", async () => {
    await expect(withWorkspace(w.db, asA(w.alice), (tx) => widgetConfigs.save(tx, "poll", { big: "x".repeat(9000) }))).rejects.toThrow(/check constraint/);
    await expect(withWorkspace(w.db, asA(w.alice), (tx) => tx.query("INSERT INTO app.widget_config (workspace_id, widget, config) VALUES (app.current_workspace_id(), 'poll', '[1]'::jsonb) ON CONFLICT (workspace_id, widget) DO UPDATE SET config = excluded.config"))).rejects.toThrow(/check constraint/);
    await expect(withWorkspace(w.db, asA(w.alice), (tx) => widgetConfigs.save(tx, "chat" as never, {}))).rejects.toThrow(/check constraint/);
  });

  it("an overlay link resolves to its own workspace's config only", async () => {
    await withWorkspace(w.db, asA(w.alice), (tx) => overlays.rotate(tx, "poll", "a".repeat(64)));
    await withWorkspace(w.db, asA(w.alice), (tx) => overlays.rotate(tx, "alerts", "b".repeat(64)));
    expect(await withSystem(w.db, (tx) => overlays.resolve(tx, "a".repeat(64)))).toEqual({ workspaceId: w.wsA, widget: "poll", config: { theme: { preset: "day" } } });
    expect(await withSystem(w.db, (tx) => overlays.resolve(tx, "b".repeat(64)))).toEqual({ workspaceId: w.wsA, widget: "alerts", config: {} });
    expect(await withSystem(w.db, (tx) => overlays.resolve(tx, "c".repeat(64)))).toBeNull();
  });
});
