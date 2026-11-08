import { parseCommand, Poll, PollError, type Clock, type PollInput, type PollSnapshot } from "@et/core";
import { ChatSourceError, type ChatSource } from "@et/youtube";
import type { PollView, SessionMode, SessionStatus, StopReason } from "../api-types";

export type { PollView, SessionMode, SessionStatus, StopReason };

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
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: SessionErrorCode };

export interface StartInput {
  workspaceId: string;
  mode: SessionMode;
  broadcastId: string;
  liveChatId: string;
  tokenCiphertext?: string;
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
}

const DEFAULTS: EngineOptions = {
  demoDurationMs: 15 * 60_000,
  maxFailures: 10,
  maxBackoffMs: 60_000,
  disabled: () => false,
  onChange: () => undefined,
};

export class SessionEngine {
  private readonly opts: EngineOptions;

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
    };
    this.sources.invalidate();
    await this.storage.delete("poll");
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
    return this.changed({ ok: true, value: this.view(stopped, poll) }).value;
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
    const state = await this.loadState();
    if (state?.status !== "live") return;
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
    for (const message of page.messages) {
      const command = parseCommand(message.text);
      if (command?.kind === "vote" && poll?.status === "open") poll.vote(message.channelId, command.option);
    }
    if (poll) await this.storage.put("poll", poll.snapshot());
    const next = { ...state, pageToken: page.nextPageToken, failures: 0, messagesSeen: state.messagesSeen + page.messages.length };
    await this.storage.put("session", next);
    await this.storage.setAlarm(now + page.waitMs);
    if (poll?.status === "open" && page.messages.length > 0) this.changed({ ok: true, value: this.view(next, poll) });
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
