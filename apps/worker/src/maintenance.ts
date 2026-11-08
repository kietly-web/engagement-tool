import { maintenance, withSystem } from "@et/db";
import type { AppDeps, AppEnv } from "./env";

// Retention job every 6 hours (ADR-006, non-negotiable 3): ended seasons' viewer rows, idle sessions, orphan members.
export async function runDailyMaintenance(env: AppEnv, deps: Pick<AppDeps, "database">): Promise<number | null> {
  const db = deps.database(env);
  if (!db) return null;
  const deleted = await withSystem(db, async (tx) => {
    const rows = await maintenance.run(tx);
    await maintenance.auditRetention(tx);
    return rows;
  });
  console.log(JSON.stringify({ event: "daily_maintenance", viewerRowsDeleted: deleted }));
  return deleted;
}
