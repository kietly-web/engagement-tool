import type { Clock } from "./clock";
import { toNfc } from "./text";
import { isChannelId } from "./viewer";

export const POLL_LIMITS = {
  minOptions: 2,
  maxOptions: 6,
  maxQuestionLength: 120,
  maxOptionLength: 40,
} as const;

export type PollStatus = "draft" | "open" | "closed";
export type VoteChangePolicy = "first" | "latest";
export type VoteOutcome = "counted" | "changed" | "duplicate" | "invalid_option" | "invalid_viewer" | "not_open";

export interface PollInput {
  question: string;
  options: string[];
  voteChange?: VoteChangePolicy;
}

export interface PollResults {
  counts: number[];
  total: number;
}

export interface PollSnapshot {
  question: string;
  options: string[];
  voteChange: VoteChangePolicy;
  status: PollStatus;
  openedAt: string | null;
  closedAt: string | null;
  votes: [channelId: string, option: number][];
  // Only closed polls rely on these: their voter map is gone, so the tally can't be rebuilt from votes.
  counts?: number[];
}

export class PollError extends Error {
  constructor(
    readonly code:
      | "too_few_options"
      | "too_many_options"
      | "empty_text"
      | "text_too_long"
      | "duplicate_option"
      | "invalid_transition"
      | "corrupt_snapshot",
  ) {
    super(code);
    this.name = "PollError";
  }
}

function cleanText(value: string, maxLength: number): string {
  const text = toNfc(value).replace(/\s+/gu, " ").trim();
  if (!text) throw new PollError("empty_text");
  if (Array.from(text).length > maxLength) throw new PollError("text_too_long");
  return text;
}

function parseTime(value: unknown): Date | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export class Poll {
  private readonly votes = new Map<string, number>();
  private readonly counts: number[];
  private statusValue: PollStatus = "draft";
  private openedAtValue: Date | null = null;
  private closedAtValue: Date | null = null;

  private constructor(
    readonly question: string,
    readonly options: readonly string[],
    readonly voteChange: VoteChangePolicy,
    private readonly clock: Clock,
  ) {
    this.counts = options.map(() => 0);
  }

  static create(input: PollInput, clock: Clock): Poll {
    if (input.options.length < POLL_LIMITS.minOptions) throw new PollError("too_few_options");
    if (input.options.length > POLL_LIMITS.maxOptions) throw new PollError("too_many_options");
    const question = cleanText(input.question, POLL_LIMITS.maxQuestionLength);
    const options = input.options.map((o) => cleanText(o, POLL_LIMITS.maxOptionLength));
    if (new Set(options.map((o) => o.toLocaleLowerCase("vi"))).size !== options.length) {
      throw new PollError("duplicate_option");
    }
    return new Poll(question, options, input.voteChange ?? "first", clock);
  }

  // Restores without re-applying text limits, so tightening them later can't break a poll open mid-stream.
  static restore(snapshot: PollSnapshot, clock: Clock): Poll {
    const corrupt = () => new PollError("corrupt_snapshot");
    const { question, options, voteChange, status } = snapshot;
    if (typeof question !== "string" || !Array.isArray(options) || !options.every((o) => typeof o === "string")) throw corrupt();
    if (options.length < POLL_LIMITS.minOptions || options.length > POLL_LIMITS.maxOptions) throw corrupt();
    if (voteChange !== "first" && voteChange !== "latest") throw corrupt();

    const openedAt = parseTime(snapshot.openedAt);
    const closedAt = parseTime(snapshot.closedAt);
    if (openedAt === undefined || closedAt === undefined || !Array.isArray(snapshot.votes)) throw corrupt();
    const consistent =
      (status === "draft" && !openedAt && !closedAt && snapshot.votes.length === 0) ||
      (status === "open" && openedAt && !closedAt) ||
      (status === "closed" && openedAt && closedAt && snapshot.votes.length === 0);
    if (!consistent) throw corrupt();

    const poll = new Poll(question, [...options], voteChange, clock);
    poll.statusValue = status;
    poll.openedAtValue = openedAt;
    poll.closedAtValue = closedAt;
    if (status === "closed") {
      const counts = snapshot.counts;
      if (!Array.isArray(counts) || counts.length !== options.length || !counts.every((n) => Number.isInteger(n) && n >= 0)) throw corrupt();
      counts.forEach((n, i) => (poll.counts[i] = n));
      return poll;
    }
    for (const entry of snapshot.votes) {
      if (!Array.isArray(entry)) continue;
      const [channelId, option] = entry;
      if (typeof channelId !== "string" || !isChannelId(channelId) || poll.votes.has(channelId)) continue;
      if (!Number.isInteger(option) || option < 1 || option > poll.options.length) continue;
      poll.votes.set(channelId, option);
      poll.counts[option - 1]! += 1;
    }
    return poll;
  }

  get status(): PollStatus {
    return this.statusValue;
  }

  get openedAt(): Date | null {
    return this.openedAtValue;
  }

  get closedAt(): Date | null {
    return this.closedAtValue;
  }

  open(): void {
    if (this.statusValue !== "draft") throw new PollError("invalid_transition");
    this.statusValue = "open";
    this.openedAtValue = this.clock.now();
  }

  // Returns the voters once and forgets which viewer chose what (ADR-006); only the counts survive.
  close(): string[] {
    if (this.statusValue !== "open") throw new PollError("invalid_transition");
    this.statusValue = "closed";
    this.closedAtValue = this.clock.now();
    const voters = [...this.votes.keys()];
    this.votes.clear();
    return voters;
  }

  vote(channelId: string, option: number): VoteOutcome {
    if (this.statusValue !== "open") return "not_open";
    if (!isChannelId(channelId)) return "invalid_viewer";
    if (!Number.isInteger(option) || option < 1 || option > this.options.length) return "invalid_option";

    const previous = this.votes.get(channelId);
    if (previous === undefined) {
      this.votes.set(channelId, option);
      this.counts[option - 1]! += 1;
      return "counted";
    }
    if (this.voteChange === "first" || previous === option) return "duplicate";

    this.votes.set(channelId, option);
    this.counts[previous - 1]! -= 1;
    this.counts[option - 1]! += 1;
    return "changed";
  }

  results(): PollResults {
    return { counts: [...this.counts], total: this.counts.reduce((sum, n) => sum + n, 0) };
  }

  snapshot(): PollSnapshot {
    return {
      question: this.question,
      options: [...this.options],
      voteChange: this.voteChange,
      status: this.statusValue,
      openedAt: this.openedAtValue?.toISOString() ?? null,
      closedAt: this.closedAtValue?.toISOString() ?? null,
      votes: [...this.votes.entries()],
      counts: [...this.counts],
    };
  }
}
