import type { Database, Queryable } from "./database";

export type MemberRole = "owner" | "moderator";

export interface MemberContext {
  memberId: string;
}

export interface WorkspaceContext extends MemberContext {
  workspaceId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContextError";
  }
}

function assertUuid(value: string, label: string): void {
  if (!UUID.test(value)) throw new ContextError(`${label} is not a UUID`);
}

// Every transaction drops to app_runtime, so RLS applies even if the connection role is mis-provisioned.
async function runAs<T>(db: Database, settings: Record<string, string>, fn: (tx: Queryable) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query("SET LOCAL ROLE app_runtime");
    for (const [name, value] of Object.entries(settings)) {
      await tx.query("SELECT set_config($1, $2, true)", [name, value]);
    }
    return fn(tx);
  });
}

export function withSystem<T>(db: Database, fn: (tx: Queryable) => Promise<T>): Promise<T> {
  return runAs(db, {}, fn);
}

export function withMember<T>(db: Database, ctx: MemberContext, fn: (tx: Queryable) => Promise<T>): Promise<T> {
  assertUuid(ctx.memberId, "memberId");
  return runAs(db, { "app.member_id": ctx.memberId }, fn);
}

export function withWorkspace<T>(db: Database, ctx: WorkspaceContext, fn: (tx: Queryable) => Promise<T>): Promise<T> {
  assertUuid(ctx.memberId, "memberId");
  assertUuid(ctx.workspaceId, "workspaceId");
  return runAs(db, { "app.member_id": ctx.memberId, "app.workspace_id": ctx.workspaceId }, fn);
}
