import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { overlays, withSystem, withWorkspace } from "../src/index";
import { buildWorld, type World } from "./fixtures";

let w: World;
beforeAll(async () => {
  w = await buildWorld();
});
afterAll(() => w.db.close());

const H1 = "1".repeat(64);
const H2 = "2".repeat(64);
const H3 = "3".repeat(64);

describe("overlay tokens", () => {
  it("only the owner creates and rotates links; lookups resolve the current hash only", async () => {
    await expect(withWorkspace(w.db, { memberId: w.bob, workspaceId: w.wsA }, (tx) => overlays.rotate(tx, "poll", H1))).rejects.toThrow(/only the workspace owner/);
    await withWorkspace(w.db, { memberId: w.alice, workspaceId: w.wsA }, (tx) => overlays.rotate(tx, "poll", H1));
    expect(await withSystem(w.db, (tx) => overlays.lookup(tx, H1))).toEqual({ workspaceId: w.wsA, widget: "poll" });

    await withWorkspace(w.db, { memberId: w.alice, workspaceId: w.wsA }, (tx) => overlays.rotate(tx, "poll", H2));
    expect(await withSystem(w.db, (tx) => overlays.lookup(tx, H1))).toBeNull();
    expect(await withSystem(w.db, (tx) => overlays.lookup(tx, H2))).toEqual({ workspaceId: w.wsA, widget: "poll" });
  });

  it("members see which widgets have links, never the hashes; other workspaces see nothing", async () => {
    const asMod = await withWorkspace(w.db, { memberId: w.bob, workspaceId: w.wsA }, (tx) => overlays.list(tx));
    expect(asMod.map((o) => o.widget)).toEqual(["poll"]);
    await expect(withWorkspace(w.db, { memberId: w.alice, workspaceId: w.wsA }, (tx) => tx.query("SELECT token_hash FROM app.overlay_token"))).rejects.toThrow(
      /permission denied/,
    );
    expect(await withWorkspace(w.db, { memberId: w.carol, workspaceId: w.wsB }, (tx) => overlays.list(tx))).toEqual([]);
    expect(await withWorkspace(w.db, { memberId: w.alice, workspaceId: w.wsB }, (tx) => overlays.list(tx))).toEqual([]);
  });

  it("rejects unknown widgets and reused hashes", async () => {
    await expect(withWorkspace(w.db, { memberId: w.alice, workspaceId: w.wsA }, (tx) => overlays.rotate(tx, "chat" as never, H3))).rejects.toThrow(/check constraint/);
    await expect(withWorkspace(w.db, { memberId: w.carol, workspaceId: w.wsB }, (tx) => overlays.rotate(tx, "poll", H2))).rejects.toThrow(/duplicate key/);
  });
});
