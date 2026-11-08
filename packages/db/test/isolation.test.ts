import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ContextError, withMember, withSystem, withWorkspace, workspaces } from "../src/index";
import { buildWorld, type World } from "./fixtures";

let w: World;
beforeAll(async () => {
  w = await buildWorld();
});
afterAll(() => w.db.close());

const asIn = <T>(memberId: string, workspaceId: string, fn: Parameters<typeof withWorkspace<T>>[2]) =>
  withWorkspace(w.db, { memberId, workspaceId }, fn);

describe("schema guarantees", () => {
  it("forces row-level security on every table in the app schema", async () => {
    const { rows } = await w.db.transaction((tx) =>
      tx.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'app' AND c.relkind IN ('r', 'p')`,
      ),
    );
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const row of rows) expect(row, row.relname).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it("runtime roles cannot bypass RLS and own nothing", async () => {
    const { rows } = await w.db.transaction((tx) =>
      tx.query<{ rolname: string; rolbypassrls: boolean; rolsuper: boolean; owns: number }>(
        `SELECT r.rolname, r.rolbypassrls, r.rolsuper,
                (SELECT count(*)::int FROM pg_class c WHERE c.relowner = r.oid) AS owns
           FROM pg_roles r WHERE r.rolname IN ('app_runtime', 'app_definer')`,
      ),
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row, row.rolname).toMatchObject({ rolbypassrls: false, rolsuper: false, owns: 0 });
  });

  it("sees nothing without a context", async () => {
    const counts = await withSystem(w.db, async (tx) => {
      const tables = ["app.member", "app.workspace", "app.workspace_member"];
      return Promise.all(tables.map(async (t) => (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t}`)).rows[0]!.n));
    });
    expect(counts).toEqual([0, 0, 0]);
  });

  it("rejects non-UUID context values before touching the database", () => {
    expect(() => withWorkspace(w.db, { memberId: w.alice, workspaceId: "' OR 1=1 --" }, async () => 0)).toThrow(ContextError);
  });
});

describe("cross-workspace isolation", () => {
  it("lists only the member's own workspaces", async () => {
    const mine = await withMember(w.db, { memberId: w.alice }, (tx) => workspaces.listMine(tx));
    expect(mine).toEqual([{ id: w.wsA, name: "Kênh A", role: "owner" }]);
    const bobs = await withMember(w.db, { memberId: w.bob }, (tx) => workspaces.listMine(tx));
    expect(bobs).toEqual([{ id: w.wsA, name: "Kênh A", role: "moderator" }]);
    expect(await withMember(w.db, { memberId: w.dave }, (tx) => workspaces.listMine(tx))).toEqual([]);
  });

  it("a member pointing the context at a workspace they don't belong to sees nothing", async () => {
    const seen = await asIn(w.alice, w.wsB, async (tx) => ({
      current: await workspaces.current(tx),
      members: await workspaces.listMembers(tx),
      rows: (await tx.query("SELECT * FROM app.workspace_member WHERE workspace_id = $1", [w.wsB])).rows,
    }));
    expect(seen).toEqual({ current: null, members: [], rows: [] });
  });

  it("cannot read another workspace's rows by id, even inside its own workspace context", async () => {
    const rows = await asIn(w.alice, w.wsA, async (tx) => ({
      ws: (await tx.query("SELECT * FROM app.workspace WHERE id = $1", [w.wsB])).rows,
      wm: (await tx.query("SELECT * FROM app.workspace_member WHERE workspace_id = $1", [w.wsB])).rows,
      carol: (await tx.query("SELECT * FROM app.member WHERE id = $1", [w.carol])).rows,
    }));
    expect(rows).toEqual({ ws: [], wm: [], carol: [] });
  });

  it("cannot update or delete another workspace's rows", async () => {
    const changed = await asIn(w.alice, w.wsA, async (tx) => ({
      renamed: (await tx.query("UPDATE app.workspace SET name = 'pwned' WHERE id = $1 RETURNING id", [w.wsB])).rows.length,
      removed: (await tx.query("DELETE FROM app.workspace_member WHERE workspace_id = $1 RETURNING member_id", [w.wsB])).rows.length,
    }));
    expect(changed).toEqual({ renamed: 0, removed: 0 });
    const b = await asIn(w.carol, w.wsB, (tx) => workspaces.current(tx));
    expect(b?.name).toBe("Kênh B");
  });

  it("cannot add members to another workspace", async () => {
    await expect(
      asIn(w.alice, w.wsA, (tx) =>
        tx.query("INSERT INTO app.workspace_member (workspace_id, member_id, role) VALUES ($1, $2, 'moderator')", [w.wsB, w.dave]),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("roles inside a workspace", () => {
  it("owner sees members with emails; moderator sees the same list", async () => {
    const forOwner = await asIn(w.alice, w.wsA, (tx) => workspaces.listMembers(tx));
    const forMod = await asIn(w.bob, w.wsA, (tx) => workspaces.listMembers(tx));
    expect(forOwner.map((m) => [m.displayName, m.role])).toEqual([["bob", "moderator"], ["alice", "owner"]]);
    expect(forMod).toEqual(forOwner);
  });

  it("only the owner renames the workspace", async () => {
    expect(await asIn(w.bob, w.wsA, (tx) => workspaces.rename(tx, "Đổi tên"))).toBe(false);
    expect(await asIn(w.alice, w.wsA, (tx) => workspaces.rename(tx, "Kênh A mới"))).toBe(true);
    await asIn(w.alice, w.wsA, (tx) => workspaces.rename(tx, "Kênh A"));
  });

  it("a moderator cannot invite, promote or remove others", async () => {
    await expect(
      asIn(w.bob, w.wsA, (tx) =>
        tx.query("INSERT INTO app.workspace_member (workspace_id, member_id, role) VALUES ($1, $2, 'moderator')", [w.wsA, w.dave]),
      ),
    ).rejects.toThrow(/row-level security/);
    const removedOwner = await asIn(w.bob, w.wsA, async (tx) =>
      (await tx.query("DELETE FROM app.workspace_member WHERE member_id = $1 RETURNING member_id", [w.alice])).rows.length,
    );
    expect(removedOwner).toBe(0);
  });

  it("an owner cannot grant ownership through a plain insert", async () => {
    await expect(
      asIn(w.alice, w.wsA, (tx) =>
        tx.query("INSERT INTO app.workspace_member (workspace_id, member_id, role) VALUES ($1, $2, 'owner')", [w.wsA, w.dave]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("the runtime role cannot insert workspaces or members directly", async () => {
    await expect(withMember(w.db, { memberId: w.dave }, (tx) => tx.query("INSERT INTO app.workspace (name) VALUES ('x')"))).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      withSystem(w.db, (tx) => tx.query("INSERT INTO app.member (google_sub, email, display_name) VALUES ('s', 'e@x.test', 'n')")),
    ).rejects.toThrow(/permission denied/);
  });

  it("members change only their own profile", async () => {
    const own = await withMember(w.db, { memberId: w.bob }, async (tx) =>
      (await tx.query("UPDATE app.member SET display_name = 'Bob' WHERE id = $1 RETURNING id", [w.bob])).rows.length,
    );
    const other = await asIn(w.bob, w.wsA, async (tx) =>
      (await tx.query("UPDATE app.member SET display_name = 'x' WHERE id = $1 RETURNING id", [w.alice])).rows.length,
    );
    expect([own, other]).toEqual([1, 0]);
  });
});

describe("definer functions", () => {
  it("upserts a member by Google subject and keeps the same id", async () => {
    const again = await withSystem(w.db, (tx) =>
      tx.query<{ id: string }>("SELECT app.upsert_member('sub-alice', 'alice@new.test', 'Alice') AS id"),
    );
    expect(again.rows[0]!.id).toBe(w.alice);
  });

  it("creating a workspace needs a member context", async () => {
    await expect(withSystem(w.db, (tx) => workspaces.create(tx, "x"))).rejects.toThrow(/no member context/);
  });

  it("allows one owned workspace per member", async () => {
    await expect(withMember(w.db, { memberId: w.alice }, (tx) => workspaces.create(tx, "Second"))).rejects.toThrow(/duplicate key/);
  });
});
