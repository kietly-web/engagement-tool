import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Migration } from "./migrate";

const DIR = fileURLToPath(new URL("../migrations/", import.meta.url));

export async function loadMigrations(): Promise<Migration[]> {
  const files = (await readdir(DIR)).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort();
  return Promise.all(files.map(async (name) => ({ name, sql: await readFile(DIR + name, "utf8") })));
}
