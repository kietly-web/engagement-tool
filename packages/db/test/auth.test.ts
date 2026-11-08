import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { members, sessions, withMember, withSystem, withWorkspace, workspaces, youtube } from "../src/index";
import { buildWorld, type World } from "./fixtures";

let w: World;
beforeAll(async () => {
  w = await buildWorld();
});
afterAll(() => w.db.close());

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const CHANNEL_A = "UCSYNTHxAAAAAAAAAAAAAAAA";
const CHANNEL_B = "UCSYNTHxBBBBBBBBBBBBBBBB";
const CIPHER = "c".repeat(80);

describe("sessions", () => {
  it("resolves a live session to its member and nothing else", async () => {
    await withSystem(w.db, (tx) => sessions.create(tx, w.alice, HASH_A, 3600));
    expect(await withSystem(w.db, (tx) => sessions.memberFor(tx, HASH_A, 3600))).toBe(w.alice);
    expect(await withSystem(w.db, (tx) => sessions.memberFor(tx, HASH_B, 3600))).toBeNull();
  });

  it("expires by absolute lifetime and by idle time", async () => {
    await withSystem(w.db, (tx) => sessions.create(tx, w.bob, HASH_B, 0));
    expect(await withSystem(w.db, (tx) => sessions.memberFor(tx, HASH_B, 3600))).toBeNull();
    expect(await withSystem(w.db, (tx) => sessions.memberFor(tx, HASH_A, 0))).toBeNull();
  });

  it("deletes a session", async () => {
    await withSystem(w.db, (tx) => sessions.delete(tx, HASH_A));
    expect(await withSystem(w.db, (tx) => sessions.memberFor(tx, HASH_A, 3600))).toBeNull();
  });

  it("the runtime role cannot read the session table in any context", async () => {
    await expect(withMember(w.db, { memberId: w.alice }, (tx) => tx.query("SELECT * FROM app.session"))).rejects.toThrow(/permission denied/);
  });
});

describe("youtube connection", () => {
  it("only the owner connects; members read metadata; the token stays behind a function", async () => {
    await expect(
      withWorkspace(w.db, { memberId: w.bob, workspaceId: w.wsA }, (tx) =>
        youtube.save(tx, { channelId: CHANNEL_A, channelTitle: "Kênh A", tokenCiphertextHex: CIPHER, scopes: "youtube.readonly" }),
      ),
    ).rejects.toThrow(/only the workspace owner/);

    await withWorkspace(w.db, { memberId: w.alice, workspaceId: w.wsA }, (tx) =>
      youtube.save(tx, { channelId: CHANNEL_A, channelTitle: "Kênh A", tokenCiphertextHex: CIPHER, scopes: "youtube.readonly" }),
    );
    const asMod = await withWorkspace(w.db, { memberId: w.bob, workspaceId: w.wsA }, async (tx) => ({
      meta: await youtube.current(tx),
      token: await youtube.refreshTokenCiphertext(tx),
    }));
    expect(asMod.meta).toMatchObject({ channelId: CHANNEL_A, channelTitle: "Kênh A" });
    expect(asMod.token).toBe(CIPHER);

    await expect(
      withWorkspace(w.db, { memberId: w.alice, workspaceId: w.wsA }, (tx) => tx.query("SELECT refresh_token_enc FROM app.youtube_connection")),
    ).rejects.toThrow(/permission denied/);
  });

  it("other workspaces see neither the metadata nor the token", async () => {
    const seen = await withWorkspace(w.db, { memberId: w.carol, workspaceId: w.wsB }, async (tx) => ({
      meta: await youtube.current(tx),
      token: await youtube.refreshTokenCiphertext(tx),
      rows: (await tx.query("SELECT channel_id FROM app.youtube_connection")).rows,
    }));
    expect(seen).toEqual({ meta: null, token: null, rows: [] });
    const outsider = await withWorkspace(w.db, { memberId: w.dave, workspaceId: w.wsA }, (tx) => youtube.refreshTokenCiphertext(tx));
    expect(outsider).toBeNull();
  });

  it("a channel can be connected to only one workspace", async () => {
    await expect(
      withWorkspace(w.db, { memberId: w.carol, workspaceId: w.wsB }, (tx) =>
        youtube.save(tx, { channelId: CHANNEL_A, channelTitle: "Copy", tokenCiphertextHex: CIPHER, scopes: "x" }),
      ),
    ).rejects.toThrow(/duplicate key/);
  });

  it("only the owner disconnects", async () => {
    expect(await withWorkspace(w.db, { memberId: w.bob, workspaceId: w.wsA }, (tx) => youtube.disconnect(tx))).toBe(false);
    expect(await withWorkspace(w.db, { memberId: w.alice, workspaceId: w.wsA }, (tx) => youtube.disconnect(tx))).toBe(true);
    expect(await withWorkspace(w.db, { memberId: w.alice, workspaceId: w.wsA }, (tx) => youtube.current(tx))).toBeNull();
  });
});

describe("account deletion", () => {
  it("deletes the owner's workspace, its connection, memberships and sessions, and nobody else's data", async () => {
    await withWorkspace(w.db, { memberId: w.carol, workspaceId: w.wsB }, (tx) =>
      youtube.save(tx, { channelId: CHANNEL_B, channelTitle: "Kênh B", tokenCiphertextHex: CIPHER, scopes: "x" }),
    );
    await withSystem(w.db, (tx) => sessions.create(tx, w.carol, "d".repeat(64), 3600));

    await withMember(w.db, { memberId: w.carol }, (tx) => members.deleteMyAccount(tx));

    const counts = await w.db.transaction(async (tx) => {
      const q = async (sql: string, p: unknown[]) => (await tx.query<{ n: number }>(sql, p)).rows[0]!.n;
      return {
        carol: await q("SELECT count(*)::int AS n FROM app.member WHERE id = $1", [w.carol]),
        wsB: await q("SELECT count(*)::int AS n FROM app.workspace WHERE id = $1", [w.wsB]),
        conn: await q("SELECT count(*)::int AS n FROM app.youtube_connection WHERE workspace_id = $1", [w.wsB]),
        sessions: await q("SELECT count(*)::int AS n FROM app.session WHERE member_id = $1", [w.carol]),
        others: await q("SELECT count(*)::int AS n FROM app.member WHERE id <> $1", [w.carol]),
      };
    });
    expect(counts).toEqual({ carol: 0, wsB: 0, conn: 0, sessions: 0, others: 3 });
    expect(await withMember(w.db, { memberId: w.alice }, (tx) => workspaces.listMine(tx))).toHaveLength(1);
  });
});
