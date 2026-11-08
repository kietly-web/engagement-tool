import { maintenance, withSystem } from "@et/db";
import { SESSION_IDLE_SECONDS } from "./cookies";
import type { AppDeps, AppEnv } from "./env";

// Daily retention job (ADR-006, non-negotiable 3): ended seasons' viewer rows, idle sessions, orphan members.
export async function runDailyMaintenance(env: AppEnv, deps: Pick<AppDeps, "database">): Promise<number | null> {
  const db = deps.database(env);
  if (!db) return null;
  const deleted = await withSystem(db, (tx) => maintenance.run(tx, SESSION_IDLE_SECONDS));
  console.log(JSON.stringify({ event: "daily_maintenance", viewerRowsDeleted: deleted }));
  return deleted;
}
