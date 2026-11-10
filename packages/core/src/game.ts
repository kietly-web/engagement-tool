import { isChannelId } from "./viewer";

export const GAME_LIMITS = {
  minRange: 1,
  maxValue: 1_000_000,
  minSpan: 10,
  guessesPerViewer: 10,
} as const;

export type GameStatus = "open" | "won" | "closed";
export type GuessOutcome = "correct" | "higher" | "lower" | "out_of_range" | "limit" | "not_open" | "invalid_viewer";

export interface GuessGameSnapshot {
  min: number;
  max: number;
  secret: number;
  status: GameStatus;
  guesses: number;
  perViewer: [string, number][];
  lastGuess: { value: number; hint: "higher" | "lower" } | null;
  winner: string | null;
}

export class GameError extends Error {
  constructor(readonly code: "invalid_range" | "corrupt_snapshot") {
    super(code);
    this.name = "GameError";
  }
}

const int = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);

// Number guessing: first exact guess wins; each viewer gets a few tries so scripts can't sweep the range.
export class GuessGame {
  private constructor(private state: GuessGameSnapshot) {}

  static create(min: number, max: number, random: () => number): GuessGame {
    if (!int(min) || !int(max) || min < GAME_LIMITS.minRange || max > GAME_LIMITS.maxValue || max - min + 1 < GAME_LIMITS.minSpan) {
      throw new GameError("invalid_range");
    }
    const secret = min + Math.floor(random() * (max - min + 1));
    return new GuessGame({ min, max, secret: Math.min(secret, max), status: "open", guesses: 0, perViewer: [], lastGuess: null, winner: null });
  }

  static restore(s: GuessGameSnapshot): GuessGame {
    const ok =
      int(s.min) &&
      int(s.max) &&
      int(s.secret) &&
      int(s.guesses) &&
      s.min <= s.secret &&
      s.secret <= s.max &&
      ["open", "won", "closed"].includes(s.status) &&
      Array.isArray(s.perViewer) &&
      (s.winner === null || isChannelId(s.winner)) &&
      (s.status === "won") === (s.winner !== null);
    if (!ok) throw new GameError("corrupt_snapshot");
    const perViewer = s.perViewer.filter(([id, n]) => isChannelId(id) && int(n) && n >= 0);
    return new GuessGame({ ...s, perViewer, lastGuess: s.lastGuess && int(s.lastGuess.value) ? s.lastGuess : null });
  }

  get status(): GameStatus {
    return this.state.status;
  }

  guess(channelId: string, value: number): GuessOutcome {
    if (this.state.status !== "open") return "not_open";
    if (!isChannelId(channelId)) return "invalid_viewer";
    if (!int(value) || value < this.state.min || value > this.state.max) return "out_of_range";
    const counts = new Map(this.state.perViewer);
    const used = counts.get(channelId) ?? 0;
    if (used >= GAME_LIMITS.guessesPerViewer) return "limit";
    counts.set(channelId, used + 1);
    this.state.perViewer = [...counts.entries()];
    this.state.guesses += 1;
    if (value === this.state.secret) {
      this.state.status = "won";
      this.state.winner = channelId;
      this.state.lastGuess = null;
      return "correct";
    }
    const hint = value < this.state.secret ? "higher" : "lower";
    this.state.lastGuess = { value, hint };
    return hint;
  }

  close(): void {
    if (this.state.status === "open") this.state.status = "closed";
  }

  winner(): string | null {
    return this.state.winner;
  }

  // The secret only leaves the engine once the round is over.
  publicView(): { min: number; max: number; status: GameStatus; guesses: number; lastGuess: GuessGameSnapshot["lastGuess"]; secret: number | null } {
    return {
      min: this.state.min,
      max: this.state.max,
      status: this.state.status,
      guesses: this.state.guesses,
      lastGuess: this.state.lastGuess,
      secret: this.state.status === "open" ? null : this.state.secret,
    };
  }

  snapshot(): GuessGameSnapshot {
    return { ...this.state, perViewer: this.state.perViewer.map(([id, n]) => [id, n]), lastGuess: this.state.lastGuess && { ...this.state.lastGuess } };
  }
}
