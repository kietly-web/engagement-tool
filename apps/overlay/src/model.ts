import type { OverlayMessage, OverlayWidget } from "@et/worker/api-types";
import { safeText } from "./render";

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function parseOverlayPath(pathname: string): { token: string; widget: OverlayWidget } | null {
  const match = /^\/o\/([^/]+)\/(poll)\/?$/.exec(pathname);
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

export function parseMessage(data: unknown): OverlayMessage | null {
  if (typeof data !== "string" || data.length > 16_384) return null;
  try {
    const value = JSON.parse(data) as OverlayMessage;
    return value && value.type === "poll" ? value : null;
  } catch {
    return null;
  }
}

export function backoffMs(attempt: number): number {
  return Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5));
}
