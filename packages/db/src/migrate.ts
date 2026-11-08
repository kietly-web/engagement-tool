import type { Database } from "./database";

export interface Migration {
  name: string;
  sql: string;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function quote(text: string): string {
  return `'${text.replace(/'/g, "''")}'`;
}

export async function applyMigrations(db: Database, migrations: Migration[]): Promise<string[]> {
  await db.execAsOwner(
    "CREATE TABLE IF NOT EXISTS public.schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const applied = new Map(
    (
      await db.transaction((tx) => tx.query<{ name: string; checksum: string }>("SELECT name, checksum FROM public.schema_migrations"))
    ).rows.map((r) => [r.name, r.checksum]),
  );

  const ran: string[] = [];
  for (const migration of [...migrations].sort((a, b) => a.name.localeCompare(b.name))) {
    const checksum = await sha256(migration.sql);
    const previous = applied.get(migration.name);
    if (previous !== undefined) {
      if (previous !== checksum) throw new Error(`Migration ${migration.name} was edited after it was applied`);
      continue;
    }
    try {
      await db.execAsOwner(
        `BEGIN;\n${migration.sql}\n;INSERT INTO public.schema_migrations (name, checksum) VALUES (${quote(migration.name)}, ${quote(checksum)});\nCOMMIT;`,
      );
    } catch (error) {
      await db.execAsOwner("ROLLBACK").catch(() => {});
      throw error;
    }
    ran.push(migration.name);
  }
  return ran;
}
