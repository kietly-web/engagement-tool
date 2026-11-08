import type { Database } from "@et/db";
import { createPgDatabase } from "@et/db";
import type { FetchLike } from "@et/youtube";

// Secrets come from `wrangler secret put`; the binding and client id are added once the owner creates them (SETUP §1).
export interface AppEnv extends Env {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  TOKEN_ENCRYPTION_KEY?: string;
  SESSION_SECRET?: string;
  HYPERDRIVE?: Hyperdrive;
}

export interface AppDeps {
  database(env: AppEnv): Database | null;
  fetch: FetchLike;
  now(): Date;
}

export const defaultDeps: AppDeps = {
  database: (env) => (env.HYPERDRIVE ? createPgDatabase(env.HYPERDRIVE.connectionString) : null),
  fetch: (url, init) => fetch(url, init),
  now: () => new Date(),
};
