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
}

export class PollError extends Error {
  constructor(
    readonly code:
      | "too_few_options"
      | "too_many_options"
      | "empty_text"
      | "text_too_long"
      | "duplicate_option"
      | "invalid_transition",
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

  static restore(snapshot: PollSnapshot, clock: Clock): Poll {
    const poll = Poll.create(
      { question: snapshot.question, options: snapshot.options, voteChange: snapshot.voteChange },
      clock,
    );
    poll.statusValue = snapshot.status;
    poll.openedAtValue = snapshot.openedAt ? new Date(snapshot.openedAt) : null;
    poll.closedAtValue = snapshot.closedAt ? new Date(snapshot.closedAt) : null;
    for (const [channelId, option] of snapshot.votes) {
      if (poll.votes.has(channelId) || !isChannelId(channelId)) continue;
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

  close(): void {
    if (this.statusValue !== "open") throw new PollError("invalid_transition");
    this.statusValue = "closed";
    this.closedAtValue = this.clock.now();
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
    return { counts: [...this.counts], total: this.votes.size };
  }

  voters(): string[] {
    return [...this.votes.keys()];
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
    };
  }
}
