import { parseCommand, Poll, PollError, POINTS, PointsTally, type Clock, type PointsTallySnapshot, type PollInput, type PollSnapshot } from "@et/core";
import { ChatSourceError, type ChatSource } from "@et/youtube";
import type { LeaderboardEntry, PollView, SessionMode, SessionStatus, StopReason } from "../api-types";
import type { PointsStore } from "./points-store";

export type { PollView, SessionMode, SessionStatus, StopReason };

const LEADERBOARD_SIZE = 10;
const MAX_NAMES = 5_000;
const MAX_FLUSH_FAILURES = 5;
const MAX_FLUSH_BACKOFF_MS = 5 * 60_000;

export interface SessionStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<unknown>;
  setAlarm(scheduledTime: number): Promise<void>;
  deleteAlarm(): Promise<void>;
  deleteAll(): Promise<void>;
}

export type SessionErrorCode = "already_live" | "not_live" | "poll_open" | "no_poll" | "invalid_poll";

export interface SessionState {
  workspaceId: string;
  mode: SessionMode;
  status: "live" | "stopped";
  broadcastId: string;
  liveChatId: string;
  pageToken?: string;
  tokenCiphertext?: string;
  startedAt: string;
  stoppedAt?: string;
  stopReason?: StopReason;
  failures: number;
  messagesSeen: number;
  startedBy?: string;
  seasonId?: string | null;
  seasonName?: string | null;
  seasonEndsAt?: string | null;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: SessionErrorCode };

export interface StartInput {
  workspaceId: string;
  mode: SessionMode;
  broadcastId: string;
  liveChatId: string;
  tokenCiphertext?: string;
  startedBy?: string;
  seasonId?: string | null;
  seasonName?: string | null;
  seasonEndsAt?: string | null;
}

export interface SourceProvider {
  get(state: SessionState): Promise<ChatSource>;
  invalidate(): void;
}

export class ReconnectRequiredError extends Error {
  constructor() {
    super("reconnect_required");
    this.name = "ReconnectRequiredError";
  }
}

export interface EngineOptions {
  demoDurationMs: number;
  maxFailures: number;
  maxBackoffMs: number;
  disabled(): boolean;
  onChange(status: SessionStatus): void;
  points(state: SessionState): PointsStore | null;
  flushEveryMs: number;
}

const DEFAULTS: EngineOptions = {
  demoDurationMs: 15 * 60_000,
  maxFailures: 10,
  maxBackoffMs: 60_000,
  disabled: () => false,
  onChange: () => undefined,
  points: () => null,
  flushEveryMs: 10_000,
};

export class SessionEngine {
  private readonly opts: EngineOptions;
  // Display names live only here, in memory, for the life of the session (non-negotiable 2).
  private readonly names = new Map<string, string>();
  private readonly sessionTotals = new Map<string, number>();
  private leaderboard: { channelId: string; points: number }[] = [];
  private lastFlush = 0;
  private tally: PointsTally | null = null;
  private flushing: Promise<unknown> | null = null;
  private flushFailures = 0;
  private nextFlushAt = 0;

  constructor(
    private readonly storage: SessionStorage,
    private readonly sources: SourceProvider,
    private readonly clock: Clock,
    opts: Partial<EngineOptions> = {},
  ) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  private loadState() {
    return this.storage.get<SessionState>("session");
  }

  private async loadPoll(): Promise<Poll | null> {
    const snapshot = await this.storage.get<PollSnapshot>("poll");
    if (!snapshot) return null;
    try {
      return Poll.restore(snapshot, this.clock);
    } catch {
      await this.storage.delete("poll");
      return null;
    }
  }

  // Kept in memory even without a season, so !join dedupes per session; persisted only while points are written.
  private async loadTally(): Promise<PointsTally> {
    this.tally ??= new PointsTally(await this.storage.get<PointsTallySnapshot>("points"));
    return this.tally;
  }

  private async saveTally(state: SessionState): Promise<void> {
    if (state.seasonId && this.tally) await this.storage.put("points", this.tally.snapshot());
  }

  private async disablePoints(state: SessionState, event: string): Promise<SessionState> {
    const next = { ...state, seasonId: null, seasonEndsAt: null };
    this.tally?.dropUnwritten();
    await this.storage.delete("points");
    await this.storage.put("session", next);
    console.error(JSON.stringify({ event }));
    return next;
  }

  private leaderboardView(): LeaderboardEntry[] {
    const source =
      this.leaderboard.length > 0
        ? this.leaderboard
        : [...this.sessionTotals.entries()].map(([channelId, points]) => ({ channelId, points })).sort((a, b) => b.points - a.points);
    return source.slice(0, LEADERBOARD_SIZE).map((e, i) => ({ rank: i + 1, name: this.names.get(e.channelId) ?? null, points: e.points }));
  }

  private rememberName(channelId: string, name: string): void {
    if (!name) return;
    if (!this.names.has(channelId) && this.names.size >= MAX_NAMES) this.names.delete(this.names.keys().next().value!);
    this.names.set(channelId, name.slice(0, 40));
  }

  private resetMemory(): void {
    this.names.clear();
    this.sessionTotals.clear();
    this.leaderboard = [];
    this.lastFlush = 0;
    this.tally = null;
    this.flushFailures = 0;
    this.nextFlushAt = 0;
  }

  private async flushPoints(state: SessionState, force: boolean): Promise<{ flushed: boolean; state: SessionState }> {
    const seasonId = state.seasonId;
    const store = seasonId ? this.opts.points(state) : null;
    if (!store || !seasonId) return { flushed: false, state };
    const now = this.clock.now().getTime();
    if (!force && (now < this.nextFlushAt || now - this.lastFlush < this.opts.flushEveryMs)) return { flushed: false, state };
    const tally = await this.loadTally();
    const batch = tally.beginBatch(crypto.randomUUID());
    if (!batch) return { flushed: false, state };
    await this.saveTally(state);

    const attempt = store.flushAndTop(seasonId, batch.id, batch.deltas, LEADERBOARD_SIZE);
    this.flushing = attempt.catch(() => undefined);
    try {
      this.leaderboard = await attempt;
      tally.completeBatch(batch.id);
      this.lastFlush = now;
      this.flushFailures = 0;
      this.nextFlushAt = 0;
      await this.saveTally(state);
      return { flushed: true, state };
    } catch {
      this.flushFailures += 1;
      this.nextFlushAt = now + Math.min(this.opts.flushEveryMs * 2 ** this.flushFailures, MAX_FLUSH_BACKOFF_MS);
      if (this.flushFailures >= MAX_FLUSH_FAILURES) return { flushed: false, state: await this.disablePoints(state, "points_flush_failed") };
      return { flushed: false, state };
    } finally {
      this.flushing = null;
    }
  }

  // Waits for any flush in flight, so a batch already on its way can't re-insert the viewer after the database delete.
  async eraseViewer(channelId: string): Promise<void> {
    if (this.flushing) await this.flushing;
    const tally = await this.loadTally();
    tally.erase(channelId);
    const state = await this.loadState();
    if (state) await this.saveTally(state);
    this.names.delete(channelId);
    this.sessionTotals.delete(channelId);
    this.leaderboard = this.leaderboard.filter((e) => e.channelId !== channelId);
  }

  private view(state: SessionState | undefined, poll: Poll | null): SessionStatus {
    const pollView: PollView | null = poll && {
      question: poll.question,
      options: [...poll.options],
      status: poll.status,
      voteChange: poll.voteChange,
      ...poll.results(),
    };
    if (!state) return { status: "idle", messagesSeen: 0, poll: pollView };
    return {
      status: state.status,
      mode: state.mode,
      startedAt: state.startedAt,
      ...(state.stoppedAt && { stoppedAt: state.stoppedAt }),
      ...(state.stopReason && { stopReason: state.stopReason }),
      messagesSeen: state.messagesSeen,
      poll: pollView,
      season: state.seasonName ?? null,
      leaderboard: this.leaderboardView(),
    };
  }

  async status(): Promise<SessionStatus> {
    return this.view(await this.loadState(), await this.loadPoll());
  }

  async start(input: StartInput): Promise<Result<SessionStatus>> {
    const existing = await this.loadState();
    if (existing?.status === "live") return { ok: false, error: "already_live" };
    const state: SessionState = {
      workspaceId: input.workspaceId,
      mode: input.mode,
      status: "live",
      broadcastId: input.broadcastId,
      liveChatId: input.liveChatId,
      ...(input.tokenCiphertext && { tokenCiphertext: input.tokenCiphertext }),
      startedAt: this.clock.now().toISOString(),
      failures: 0,
      messagesSeen: 0,
      ...(input.startedBy && { startedBy: input.startedBy }),
      seasonId: input.mode === "demo" ? null : (input.seasonId ?? null),
      seasonName: input.mode === "demo" ? null : (input.seasonName ?? null),
      seasonEndsAt: input.mode === "demo" ? null : (input.seasonEndsAt ?? null),
    };
    this.sources.invalidate();
    this.resetMemory();
    await this.storage.delete("poll");
    await this.storage.delete("points");
    await this.storage.put("session", state);
    await this.storage.setAlarm(this.clock.now().getTime());
    return this.changed({ ok: true, value: this.view(state, null) });
  }

  async stop(reason: StopReason = "manual"): Promise<SessionStatus> {
    const state = await this.loadState();
    if (state?.status !== "live") return this.status();
    const poll = await this.loadPoll();
    if (poll?.status === "open") {
      poll.close();
      await this.storage.put("poll", poll.snapshot());
    }
    await this.flushPoints(state, true);
    await this.storage.delete("points");
    this.tally = null;
    // YouTube identifiers and the token copy go at stop, so nothing YouTube-derived lingers in DO storage (NN3).
    const stopped: SessionState = {
      ...state,
      status: "stopped",
      broadcastId: "",
      liveChatId: "",
      stoppedAt: this.clock.now().toISOString(),
      stopReason: reason,
    };
    delete stopped.tokenCiphertext;
    delete stopped.pageToken;
    await this.storage.put("session", stopped);
    await this.storage.deleteAlarm();
    this.sources.invalidate();
    const result = this.changed({ ok: true, value: this.view(stopped, poll) }).value;
    this.names.clear();
    return result;
  }

  async createPoll(input: PollInput): Promise<Result<SessionStatus>> {
    const state = await this.loadState();
    if (state?.status !== "live") return { ok: false, error: "not_live" };
    const current = await this.loadPoll();
    if (current?.status === "open") return { ok: false, error: "poll_open" };
    let poll: Poll;
    try {
      poll = Poll.create(input, this.clock);
    } catch (error) {
      if (error instanceof PollError) return { ok: false, error: "invalid_poll" };
      throw error;
    }
    poll.open();
    await this.storage.put("poll", poll.snapshot());
    return this.changed({ ok: true, value: this.view(state, poll) });
  }

  async closePoll(): Promise<Result<SessionStatus>> {
    const poll = await this.loadPoll();
    if (poll?.status !== "open") return { ok: false, error: "no_poll" };
    poll.close();
    await this.storage.put("poll", poll.snapshot());
    return this.changed({ ok: true, value: this.view(await this.loadState(), poll) });
  }

  private changed<T extends { ok: true; value: SessionStatus }>(result: T): T {
    try {
      this.opts.onChange(result.value);
    } catch {
      // A failing listener (e.g. a dead socket) must never break session handling.
    }
    return result;
  }

  async purge(): Promise<void> {
    this.sources.invalidate();
    await this.storage.deleteAlarm();
    await this.storage.deleteAll();
  }

  // Any unexpected error stops the session; otherwise the alarm would give up and leave it stuck "live".
  async tick(): Promise<void> {
    try {
      await this.tickOnce();
    } catch {
      await this.stop("internal_error").catch(() => undefined);
    }
  }

  private async tickOnce(): Promise<void> {
    let state = await this.loadState();
    if (state?.status !== "live") return;
    if (state.seasonId && state.seasonEndsAt && this.clock.now().getTime() >= Date.parse(state.seasonEndsAt)) {
      state = await this.disablePoints(state, "season_ended_mid_session");
    }
    if (this.opts.disabled()) {
      await this.stop("disabled");
      return;
    }
    const now = this.clock.now().getTime();
    if (state.mode === "demo" && now - Date.parse(state.startedAt) >= this.opts.demoDurationMs) {
      await this.stop("demo_finished");
      return;
    }

    let page;
    try {
      const source = await this.sources.get(state);
      page = await source.fetchPage(state.liveChatId, state.pageToken);
    } catch (error) {
      await this.handleFailure(state, error, now);
      return;
    }

    const poll = await this.loadPoll();
    const tally = await this.loadTally();
    let scored = false;
    for (const message of page.messages) {
      this.rememberName(message.channelId, message.displayName);
      const command = parseCommand(message.text);
      let earned = 0;
      if (command?.kind === "vote" && poll?.status === "open" && poll.vote(message.channelId, command.option) === "counted") {
        if (tally.countedVote(message.channelId)) earned = POINTS.countedVote;
      } else if (command?.kind === "join" && tally.join(message.channelId)) {
        earned = POINTS.join;
      }
      if (earned > 0) {
        scored = true;
        this.sessionTotals.set(message.channelId, (this.sessionTotals.get(message.channelId) ?? 0) + earned);
      }
    }
    if (poll) await this.storage.put("poll", poll.snapshot());
    if (scored) await this.saveTally(state);
    const flush = await this.flushPoints(state, false);
    const flushed = flush.flushed;
    state = flush.state;
    const next = { ...state, pageToken: page.nextPageToken, failures: 0, messagesSeen: state.messagesSeen + page.messages.length };
    await this.storage.put("session", next);
    await this.storage.setAlarm(now + page.waitMs);
    if ((poll?.status === "open" && page.messages.length > 0) || scored || flushed) this.changed({ ok: true, value: this.view(next, poll) });
  }

  private async handleFailure(state: SessionState, error: unknown, now: number): Promise<void> {
    if (error instanceof ReconnectRequiredError) return void (await this.stop("reconnect_required"));
    if (error instanceof ChatSourceError && error.kind === "ended") return void (await this.stop("broadcast_ended"));
    if (error instanceof ChatSourceError && error.kind === "quota") return void (await this.stop("quota"));
    if (error instanceof ChatSourceError && error.kind === "unauthorized") this.sources.invalidate();

    const failures = state.failures + 1;
    if (failures >= this.opts.maxFailures) return void (await this.stop("youtube_unavailable"));
    await this.storage.put("session", { ...state, failures });
    await this.storage.setAlarm(now + Math.min(1_000 * 2 ** failures, this.opts.maxBackoffMs));
  }
}
