import { PGlite } from "@electric-sql/pglite";
import type { Database } from "./database";
import { applyMigrations, type Migration } from "./migrate";

export function createPgliteDatabase(pg: PGlite): Database {
  return {
    transaction: (fn) => pg.transaction((tx) => fn({ query: async (text, params) => ({ rows: (await tx.query(text, params)).rows as never[] }) })),
    execAsOwner: async (sql) => {
      await pg.exec(sql);
    },
    close: () => pg.close(),
  };
}

export async function createTestDatabase(migrations: Migration[]): Promise<Database> {
  const db = createPgliteDatabase(new PGlite());
  await applyMigrations(db, migrations);
  return db;
}
