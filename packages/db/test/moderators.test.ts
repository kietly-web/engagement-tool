import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { audit, invites, membership, members, withMember, withSystem, withWorkspace, workspaces, type Queryable } from "../src/index";
import { buildWorld, type World } from "./fixtures";

let w: World;
let erin = "";
beforeAll(async () => {
  w = await buildWorld();
  erin = await withSystem(w.db, (tx) => members.upsertFromGoogle(tx, { googleSub: "sub-erin", email: "Erin@Example.test", displayName: "erin" }));
});
afterAll(() => w.db.close());

const H = (n: number) => String(n).repeat(64).slice(0, 64);
const asA = <T>(member: string, fn: (tx: Queryable) => Promise<T>) => withWorkspace(w.db, { memberId: member, workspaceId: w.wsA }, fn);

describe("invites", () => {
  it("only the owner invites; the address is stored lower-cased", async () => {
    await expect(asA(w.bob, (tx) => invites.create(tx, "erin@example.test", H(1)))).rejects.toThrow(/only the workspace owner/);
    await asA(w.alice, (tx) => invites.create(tx, " Erin@Example.TEST ", H(1)));
    expect((await asA(w.alice, (tx) => invites.pending(tx))).map((i) => i.email)).toEqual(["erin@example.test"]);
    expect(await asA(w.bob, (tx) => invites.pending(tx))).toEqual([]);
  });

  it("can't be read for its hash and isn't visible to other workspaces", async () => {
    await expect(asA(w.alice, (tx) => tx.query("SELECT token_hash FROM app.invite"))).rejects.toThrow(/permission denied/);
    expect(await withWorkspace(w.db, { memberId: w.carol, workspaceId: w.wsB }, (tx) => invites.pending(tx))).toEqual([]);
  });

  it("is accepted only by the invited, verified email, once", async () => {
    expect(await withMember(w.db, { memberId: w.dave }, (tx) => invites.accept(tx, H(1)))).toEqual({ workspaceId: null, outcome: "email_mismatch" });
    expect(await withMember(w.db, { memberId: erin }, (tx) => invites.accept(tx, H(9)))).toEqual({ workspaceId: null, outcome: "invalid" });
    expect(await withMember(w.db, { memberId: erin }, (tx) => invites.accept(tx, H(1)))).toEqual({ workspaceId: w.wsA, outcome: "accepted" });
    expect(await withMember(w.db, { memberId: erin }, (tx) => invites.accept(tx, H(1)))).toEqual({ workspaceId: null, outcome: "invalid" });
    expect((await withMember(w.db, { memberId: erin }, (tx) => workspaces.listMine(tx))).map((x) => [x.id, x.role])).toEqual([[w.wsA, "moderator"]]);
  });

  it("expired invites can't be accepted", async () => {
    await asA(w.alice, (tx) => invites.create(tx, "dave@example.test", H(2)));
    await w.db.transaction((tx) => tx.query("UPDATE app.invite SET created_at = now() - interval '8 days', expires_at = now() - interval '1 day' WHERE token_hash = decode($1, 'hex')", [H(2)]));
    expect(await withMember(w.db, { memberId: w.dave }, (tx) => invites.accept(tx, H(2)))).toEqual({ workspaceId: null, outcome: "invalid" });
  });

  it("only the owner revokes a pending invite", async () => {
    const id = await asA(w.alice, (tx) => invites.create(tx, "someone@example.test", H(3)));
    expect(await asA(w.bob, (tx) => invites.revoke(tx, id))).toBe(false);
    expect(await asA(w.alice, (tx) => invites.revoke(tx, id))).toBe(true);
  });

  it("caps pending invites at 20", async () => {
    for (let i = 0; i < 20; i++) await asA(w.alice, (tx) => invites.create(tx, `x${i}@example.test`, (100 + i).toString(16).padStart(64, "a")));
    await expect(asA(w.alice, (tx) => invites.create(tx, "y@example.test", "f".repeat(64)))).rejects.toThrow(/too many pending/);
  });
});

describe("membership changes", () => {
  it("an owner removes a moderator; a moderator leaves; nobody removes the owner", async () => {
    expect(await asA(erin, (tx) => membership.remove(tx, w.alice))).toBe(false);
    expect(await asA(erin, (tx) => membership.remove(tx, erin))).toBe(true);
    expect(await asA(w.alice, (tx) => membership.remove(tx, w.alice))).toBe(false);
    expect(await asA(w.alice, (tx) => membership.remove(tx, w.bob))).toBe(true);
  });
});

describe("audit log", () => {
  it("records actions for owners only, never across workspaces", async () => {
    const entries = await asA(w.alice, (tx) => audit.recent(tx));
    expect(entries.map((e) => e.action)).toEqual(expect.arrayContaining(["invite_created", "invite_accepted"]));
    expect(entries.find((e) => e.action === "invite_created")?.actorName).toBe("alice");
    expect(entries.find((e) => e.action === "invite_accepted")?.actorName).toBeNull();
    expect(await withWorkspace(w.db, { memberId: w.carol, workspaceId: w.wsB }, (tx) => audit.recent(tx))).toEqual([]);
    await expect(withWorkspace(w.db, { memberId: w.dave, workspaceId: w.wsA }, (tx) => audit.log(tx, "season_started"))).rejects.toThrow(/not a member/);
  });

  it("rejects unknown actions and oversized detail", async () => {
    await expect(asA(w.alice, (tx) => audit.log(tx, "drop_tables" as never))).rejects.toThrow(/check constraint/);
    await expect(asA(w.alice, (tx) => audit.log(tx, "season_started", { x: "y".repeat(600) }))).rejects.toThrow(/check constraint/);
  });
});
