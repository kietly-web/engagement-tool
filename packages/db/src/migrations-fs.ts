import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Migration } from "./migrate";

const DIR = join(import.meta.dirname, "..", "migrations");

export async function loadMigrations(): Promise<Migration[]> {
  const files = (await readdir(DIR)).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort();
  return Promise.all(files.map(async (name) => ({ name, sql: await readFile(join(DIR, name), "utf8") })));
}
