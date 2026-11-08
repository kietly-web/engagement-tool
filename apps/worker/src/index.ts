import { app } from "./app";
import type { AppEnv } from "./env";

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<AppEnv>;
