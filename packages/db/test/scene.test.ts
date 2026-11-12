import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { overlays, widgetConfigs, withSystem, withWorkspace } from "../src/index";
import { buildWorld, type World } from "./fixtures";

let w: World;
beforeAll(async () => {
  w = await buildWorld();
});
afterAll(() => w.db.close());

const A = (m: string) => ({ memberId: m, workspaceId: w.wsA });
const ENC = "01" + "ab".repeat(40);

describe("scene overlay links", () => {
  it("only the owner sets and reads back the encrypted link; hash lookups still work", async () => {
    await expect(withWorkspace(w.db, A(w.bob), (tx) => overlays.set(tx, "scene", "5".repeat(64), ENC))).rejects.toThrow(/only the workspace owner/);
    await withWorkspace(w.db, A(w.alice), (tx) => overlays.set(tx, "scene", "5".repeat(64), ENC));
    expect(await withWorkspace(w.db, A(w.alice), (tx) => overlays.tokenCiphertext(tx, "scene"))).toBe(ENC);
    expect(await withWorkspace(w.db, A(w.bob), (tx) => overlays.tokenCiphertext(tx, "scene"))).toBeNull();
    expect(await withWorkspace(w.db, { memberId: w.carol, workspaceId: w.wsB }, (tx) => overlays.tokenCiphertext(tx, "scene"))).toBeNull();
    expect(await withSystem(w.db, (tx) => overlays.resolve(tx, "5".repeat(64)))).toMatchObject({ workspaceId: w.wsA, widget: "scene" });
    await expect(withWorkspace(w.db, A(w.alice), (tx) => tx.query("SELECT token_enc FROM app.overlay_token"))).rejects.toThrow(/permission denied/);
  });

  it("a scene link returns all of its own workspace's widget configs, and only for scene links", async () => {
    await withWorkspace(w.db, A(w.alice), (tx) => widgetConfigs.save(tx, "poll", { theme: { preset: "neon" } }));
    await withWorkspace(w.db, A(w.alice), (tx) => widgetConfigs.save(tx, "alerts", { theme: { preset: "day" } }));
    await withWorkspace(w.db, { memberId: w.carol, workspaceId: w.wsB }, (tx) => widgetConfigs.save(tx, "poll", { theme: { preset: "pastel" } }));
    expect(await withSystem(w.db, (tx) => overlays.sceneConfigs(tx, "5".repeat(64)))).toEqual({ poll: { theme: { preset: "neon" } }, alerts: { theme: { preset: "day" } } });
    await withWorkspace(w.db, A(w.alice), (tx) => overlays.set(tx, "poll", "6".repeat(64), ENC));
    expect(await withSystem(w.db, (tx) => overlays.sceneConfigs(tx, "6".repeat(64)))).toEqual({});
    expect(await withSystem(w.db, (tx) => overlays.sceneConfigs(tx, "7".repeat(64)))).toEqual({});
  });
});
