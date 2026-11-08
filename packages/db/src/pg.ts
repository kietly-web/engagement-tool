import { Client } from "pg";
import type { Database, Queryable } from "./database";

// One short-lived client per transaction: Hyperdrive pools the real connections near the database.
export function createPgDatabase(connectionString: string): Database {
  async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    const client = new Client({ connectionString });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.end();
    }
  }

  return {
    transaction: (fn) =>
      withClient(async (client) => {
        await client.query("BEGIN");
        try {
          const tx: Queryable = {
            query: async (text, params) => ({ rows: (await client.query(text, params)).rows }),
          };
          const result = await fn(tx);
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client.query("ROLLBACK").catch(() => {});
          throw error;
        }
      }),
    execAsOwner: (sql) =>
      withClient(async (client) => {
        await client.query(sql);
      }),
    close: async () => {},
  };
}
