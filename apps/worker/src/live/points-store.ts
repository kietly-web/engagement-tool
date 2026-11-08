import { points, withWorkspace, type Database } from "@et/db";
import type { PointsDelta } from "@et/core";

export interface PointsStore {
  flush(seasonId: string, deltas: [string, PointsDelta][]): Promise<void>;
  top(seasonId: string, limit: number): Promise<{ channelId: string; points: number }[]>;
}

// Writes as the member who started the session, so RLS still checks they belong to the workspace.
export class DbPointsStore implements PointsStore {
  constructor(
    private readonly db: Database,
    private readonly ctx: { memberId: string; workspaceId: string },
  ) {}

  async flush(seasonId: string, deltas: [string, PointsDelta][]): Promise<void> {
    await withWorkspace(this.db, this.ctx, (tx) => points.flush(tx, seasonId, deltas));
  }

  async top(seasonId: string, limit: number) {
    const rows = await withWorkspace(this.db, this.ctx, (tx) => points.top(tx, seasonId, limit));
    return rows.map((r) => ({ channelId: r.channelId, points: r.points }));
  }
}
