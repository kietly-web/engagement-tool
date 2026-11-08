import { app } from "./app";
import { defaultDeps, type AppEnv } from "./env";
import { runDailyMaintenance } from "./maintenance";

export { LiveSession, QuotaKeeper } from "./live/durable";

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runDailyMaintenance(env, defaultDeps));
  },
} satisfies ExportedHandler<AppEnv>;
