import { createPgDatabase } from "../src/pg.ts";
import { applyMigrations } from "../src/migrate.ts";
import { loadMigrations } from "../src/migrations-fs.ts";

const url = process.env.DATABASE_OWNER_URL;
if (!url) {
  console.error("Set DATABASE_OWNER_URL to the owner role's connection string (never commit it).");
  process.exit(1);
}

const ran = await applyMigrations(createPgDatabase(url), await loadMigrations());
console.log(ran.length ? `Applied: ${ran.join(", ")}` : "Up to date.");
