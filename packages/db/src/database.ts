export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface Database {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  // Raw multi-statement SQL as the connecting role; only migrations use it.
  execAsOwner(sql: string): Promise<void>;
  close(): Promise<void>;
}
