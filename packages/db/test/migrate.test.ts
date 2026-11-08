import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "../src/migrate";
import { loadMigrations } from "../src/migrations-fs";
import { createPgliteDatabase } from "../src/testing";

describe("applyMigrations", () => {
  it("applies once and is a no-op on rerun", async () => {
    const db = createPgliteDatabase(new PGlite());
    const migrations = await loadMigrations();
    expect(await applyMigrations(db, migrations)).toEqual(migrations.map((m) => m.name));
    expect(await applyMigrations(db, migrations)).toEqual([]);
    await db.close();
  });

  it("refuses to run when an applied migration was edited", async () => {
    const db = createPgliteDatabase(new PGlite());
    const migrations = await loadMigrations();
    await applyMigrations(db, migrations);
    const edited = migrations.map((m, i) => (i === 0 ? { ...m, sql: `${m.sql}\n-- edited` } : m));
    await expect(applyMigrations(db, edited)).rejects.toThrow(/edited after it was applied/);
    await db.close();
  });

  it("rolls back a failing migration completely", async () => {
    const db = createPgliteDatabase(new PGlite());
    await applyMigrations(db, await loadMigrations());
    await expect(
      applyMigrations(db, [...(await loadMigrations()), { name: "9999_broken.sql", sql: "CREATE TABLE app.half (id int); SELECT 1/0;" }]),
    ).rejects.toThrow();
    const { rows } = await db.transaction((tx) =>
      tx.query("SELECT to_regclass('app.half') AS t, (SELECT count(*)::int FROM public.schema_migrations WHERE name = '9999_broken.sql') AS n"),
    );
    expect(rows[0]).toEqual({ t: null, n: 0 });
    await db.close();
  });
});
