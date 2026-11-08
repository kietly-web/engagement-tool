import { app } from "./app";
import { defaultDeps, type AppEnv } from "./env";
import { runDailyMaintenance } from "./maintenance";

export { LiveSession, QuotaKeeper } from "./live/durable";

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      runDailyMaintenance(env, defaultDeps).catch((error: unknown) => {
        console.error(JSON.stringify({ event: "daily_maintenance_failed", name: error instanceof Error ? error.name : "unknown" }));
      }),
    );
  },
} satisfies ExportedHandler<AppEnv>;
