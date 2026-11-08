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

const MIGRATOR = "et_test_migrator";

// Neon's owner is not a superuser, so tests migrate as a CREATEROLE, non-superuser role to catch privilege gaps.
export async function createTestDatabase(migrations: Migration[]): Promise<Database> {
  const pg = new PGlite();
  await pg.exec(`
    CREATE ROLE ${MIGRATOR} CREATEROLE NOSUPERUSER NOBYPASSRLS;
    DO $$ BEGIN EXECUTE format('GRANT CREATE ON DATABASE %I TO ${MIGRATOR}', current_database()); END $$;
    GRANT CREATE ON SCHEMA public TO ${MIGRATOR};
  `);
  const db = createPgliteDatabase(pg);
  const asMigrator: Database = {
    ...db,
    execAsOwner: async (sql) => {
      try {
        await pg.exec(`SET ROLE ${MIGRATOR};\n${sql}`);
      } catch (error) {
        await pg.exec("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        await pg.exec("RESET ROLE");
      }
    },
  };
  await applyMigrations(asMigrator, migrations);
  return db;
}
