import type { OverlayMessage, OverlayWidget } from "@et/worker/api-types";
import { safeText } from "./render";

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function parseOverlayPath(pathname: string): { token: string; widget: OverlayWidget } | null {
  const match = /^\/o\/([^/]+)\/(poll|leaderboard|game)\/?$/.exec(pathname);
  if (!match || !TOKEN.test(match[1]!)) return null;
  return { token: match[1]!, widget: match[2] as OverlayWidget };
}

export interface PollRow {
  label: string;
  count: number;
  percent: number;
}

export interface PollModel {
  question: string;
  rows: PollRow[];
  total: number;
  closed: boolean;
}

export function pollModel(message: OverlayMessage): PollModel | null {
  if (message.type !== "poll" || !message.poll) return null;
  const { question, options, counts, total, status } = message.poll;
  const sum = counts.reduce((a, b) => a + b, 0);
  return {
    question: safeText(question, 120),
    rows: options.slice(0, 6).map((option, i) => {
      const count = Math.max(0, Math.trunc(counts[i] ?? 0));
      return { label: `${i + 1}. ${safeText(option, 40)}`, count, percent: sum > 0 ? Math.round((100 * count) / sum) : 0 };
    }),
    total: Math.max(0, Math.trunc(total)),
    closed: status === "closed",
  };
}

export interface LeaderboardRow {
  rank: number;
  name: string | null;
  points: number;
}

export function leaderboardModel(message: OverlayMessage): { title: string | null; rows: LeaderboardRow[] } | null {
  if (message.type !== "leaderboard" || !Array.isArray(message.entries)) return null;
  return {
    title: typeof message.title === "string" ? safeText(message.title, 60) : null,
    rows: message.entries.slice(0, 10).map((e, i) => ({
      rank: Number.isInteger(e.rank) && e.rank > 0 ? e.rank : i + 1,
      name: typeof e.name === "string" && e.name ? safeText(e.name, 24) : null,
      points: Math.max(0, Math.trunc(Number(e.points) || 0)),
    })),
  };
}

export interface GameModel {
  range: [number, number];
  status: "open" | "won" | "closed";
  guesses: number;
  lastGuess: { value: number; hint: "higher" | "lower" } | null;
  secret: number | null;
  winnerName: string | null;
}

export function gameModel(message: OverlayMessage): GameModel | null {
  if (message.type !== "game" || !message.game) return null;
  const g = message.game;
  const n = (v: unknown) => Math.max(0, Math.trunc(Number(v) || 0));
  return {
    range: [n(g.min), n(g.max)],
    status: g.status === "won" || g.status === "closed" ? g.status : "open",
    guesses: n(g.guesses),
    lastGuess: g.lastGuess && (g.lastGuess.hint === "higher" || g.lastGuess.hint === "lower") ? { value: n(g.lastGuess.value), hint: g.lastGuess.hint } : null,
    secret: g.status === "open" || g.secret === null ? null : n(g.secret),
    winnerName: typeof g.winnerName === "string" && g.winnerName ? safeText(g.winnerName, 24) : null,
  };
}

export function parseMessage(data: unknown): OverlayMessage | null {
  if (typeof data !== "string" || data.length > 16_384) return null;
  try {
    const value = JSON.parse(data) as OverlayMessage;
    return value && (value.type === "poll" || value.type === "leaderboard" || value.type === "game") ? value : null;
  } catch {
    return null;
  }
}

export const ROTATED_CLOSE_CODE = 4001;
const GIVE_UP_AFTER = 8;

// After repeated failures (dead or rotated link left in OBS) retry only every 10 minutes.
export function backoffMs(attempt: number): number {
  if (attempt >= GIVE_UP_AFTER) return 10 * 60_000;
  return Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5));
}

export function shouldReconnect(closeCode: number): boolean {
  return closeCode !== ROTATED_CLOSE_CODE;
}
