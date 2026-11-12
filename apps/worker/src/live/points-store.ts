import { points, withWorkspace, type Database } from "@et/db";
import type { PointsDelta } from "@et/core";

export interface PointsStore {
  // One transaction: apply the batch at most once, then read the top of the leaderboard.
  flushAndTop(seasonId: string, batchId: string, deltas: [string, PointsDelta][], limit: number): Promise<{ channelId: string; points: number }[]>;
  top(seasonId: string, limit: number): Promise<{ channelId: string; points: number }[]>;
}

// Writes as the member who started the session, so RLS still checks they belong to the workspace.
export class DbPointsStore implements PointsStore {
  constructor(
    private readonly db: Database,
    private readonly ctx: { memberId: string; workspaceId: string },
  ) {}

  async top(seasonId: string, limit: number) {
    const rows = await withWorkspace(this.db, this.ctx, (tx) => points.top(tx, seasonId, limit));
    return rows.map((r) => ({ channelId: r.channelId, points: r.points }));
  }

  async flushAndTop(seasonId: string, batchId: string, deltas: [string, PointsDelta][], limit: number) {
    const rows = await withWorkspace(this.db, this.ctx, async (tx) => {
      await points.flush(tx, seasonId, batchId, deltas);
      return points.top(tx, seasonId, limit);
    });
    return rows.map((r) => ({ channelId: r.channelId, points: r.points }));
  }
}
