import { isChannelId } from "./viewer";

export const POINTS = {
  join: 10,
  countedVote: 5,
} as const;

export const SEASON_LIMITS = {
  minDays: 1,
  // 29, not 30: season end plus cleanup lag must stay inside the 30-day limit (non-negotiable 3, Q-L3).
  maxDays: 29,
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

export interface PointsBatch {
  id: string;
  deltas: [string, PointsDelta][];
}

export interface PointsTallySnapshot {
  pending?: [string, PointsDelta][];
  joined?: string[];
  erased?: string[];
  inflight?: PointsBatch | null;
}

const validDelta = (d: PointsDelta) => [d.points, d.joins, d.votes].every((n) => Number.isInteger(n) && n >= 0);

// Accumulates per-viewer deltas for one live session between database flushes; holds channel ids and counters only.
// A batch taken for flushing stays "in flight" under one id until acknowledged, so retries reuse the same id.
export class PointsTally {
  private readonly pending = new Map<string, PointsDelta>();
  private readonly joined = new Set<string>();
  private readonly erased = new Set<string>();
  private inflight: PointsBatch | null = null;

  constructor(snapshot?: PointsTallySnapshot) {
    for (const [id, d] of snapshot?.pending ?? []) if (isChannelId(id) && validDelta(d)) this.pending.set(id, { ...d });
    for (const id of snapshot?.joined ?? []) if (isChannelId(id)) this.joined.add(id);
    for (const id of snapshot?.erased ?? []) if (isChannelId(id)) this.erased.add(id);
    const inflight = snapshot?.inflight;
    if (inflight && typeof inflight.id === "string" && Array.isArray(inflight.deltas)) {
      this.inflight = { id: inflight.id, deltas: inflight.deltas.filter(([id, d]) => isChannelId(id) && validDelta(d)) };
    }
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
    if (!isChannelId(channelId) || this.joined.has(channelId) || this.erased.has(channelId)) return false;
    this.joined.add(channelId);
    this.add(channelId, { points: POINTS.join, joins: 1 });
    return true;
  }

  countedVote(channelId: string): boolean {
    if (!isChannelId(channelId) || this.erased.has(channelId)) return false;
    this.add(channelId, { points: POINTS.countedVote, votes: 1 });
    return true;
  }

  // An erased viewer earns nothing more this session, and is removed from anything not yet written.
  erase(channelId: string): void {
    this.erased.add(channelId);
    this.pending.delete(channelId);
    this.joined.delete(channelId);
    if (this.inflight) this.inflight = { id: this.inflight.id, deltas: this.inflight.deltas.filter(([id]) => id !== channelId) };
  }

  hasPending(): boolean {
    return this.pending.size > 0 || this.inflight !== null;
  }

  beginBatch(newId: string): PointsBatch | null {
    if (this.inflight) return this.inflight;
    if (this.pending.size === 0) return null;
    this.inflight = { id: newId, deltas: [...this.pending.entries()] };
    this.pending.clear();
    return this.inflight;
  }

  completeBatch(id: string): void {
    if (this.inflight?.id === id) this.inflight = null;
  }

  dropUnwritten(): void {
    this.pending.clear();
    this.inflight = null;
  }

  snapshot(): Required<PointsTallySnapshot> {
    return {
      pending: [...this.pending.entries()].map(([id, d]) => [id, { ...d }]),
      joined: [...this.joined],
      erased: [...this.erased],
      inflight: this.inflight && { id: this.inflight.id, deltas: this.inflight.deltas.map(([id, d]) => [id, { ...d }]) },
    };
  }
}
