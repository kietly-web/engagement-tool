import { isChannelId } from "./viewer";

export const POINTS = {
  join: 10,
  countedVote: 5,
} as const;

export const SEASON_LIMITS = {
  minDays: 1,
  // YouTube API data may be kept at most 30 days unless refreshed (non-negotiable 3, Q-L3).
  maxDays: 30,
  maxNameLength: 60,
} as const;

export interface PointsDelta {
  points: number;
  joins: number;
  votes: number;
}

export class PointsError extends Error {
  constructor(readonly code: "season_length" | "season_name") {
    super(code);
    this.name = "PointsError";
  }
}

export function seasonWindow(startsAt: Date, days: number): { startsAt: Date; endsAt: Date } {
  if (!Number.isInteger(days) || days < SEASON_LIMITS.minDays || days > SEASON_LIMITS.maxDays) throw new PointsError("season_length");
  return { startsAt, endsAt: new Date(startsAt.getTime() + days * 86_400_000) };
}

export function cleanSeasonName(name: string): string {
  const clean = name.normalize("NFC").replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/\s+/gu, " ").trim();
  if (!clean || Array.from(clean).length > SEASON_LIMITS.maxNameLength) throw new PointsError("season_name");
  return clean;
}

// Accumulates per-viewer deltas for one live session between database flushes; holds channel ids and counters only.
export class PointsTally {
  private readonly pending = new Map<string, PointsDelta>();
  private readonly joined = new Set<string>();

  constructor(snapshot?: { pending?: [string, PointsDelta][]; joined?: string[] }) {
    for (const [id, d] of snapshot?.pending ?? []) {
      if (isChannelId(id) && [d.points, d.joins, d.votes].every((n) => Number.isInteger(n) && n >= 0)) this.pending.set(id, { ...d });
    }
    for (const id of snapshot?.joined ?? []) if (isChannelId(id)) this.joined.add(id);
  }

  private add(channelId: string, delta: Partial<PointsDelta>): void {
    const current = this.pending.get(channelId) ?? { points: 0, joins: 0, votes: 0 };
    this.pending.set(channelId, {
      points: current.points + (delta.points ?? 0),
      joins: current.joins + (delta.joins ?? 0),
      votes: current.votes + (delta.votes ?? 0),
    });
  }

  join(channelId: string): boolean {
    if (!isChannelId(channelId) || this.joined.has(channelId)) return false;
    this.joined.add(channelId);
    this.add(channelId, { points: POINTS.join, joins: 1 });
    return true;
  }

  countedVote(channelId: string): void {
    if (isChannelId(channelId)) this.add(channelId, { points: POINTS.countedVote, votes: 1 });
  }

  erase(channelId: string): void {
    this.pending.delete(channelId);
    this.joined.delete(channelId);
  }

  hasPending(): boolean {
    return this.pending.size > 0;
  }

  takePending(): [string, PointsDelta][] {
    const out = [...this.pending.entries()];
    this.pending.clear();
    return out;
  }

  restorePending(entries: [string, PointsDelta][]): void {
    for (const [id, d] of entries) this.add(id, d);
  }

  snapshot(): { pending: [string, PointsDelta][]; joined: string[] } {
    return { pending: [...this.pending.entries()].map(([id, d]) => [id, { ...d }]), joined: [...this.joined] };
  }
}
