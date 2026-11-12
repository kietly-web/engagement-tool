import type { AlertsConfigView, OverlayAlertMessage } from "@et/worker/api-types";
import { safeText } from "./render";

export const STICKER_EMOJI: Record<string, string> = {
  heart: "❤\uFE0F",
  fire: "🔥",
  clap: "👏",
  star: "⭐",
  laugh: "😂",
  wave: "👋",
  gift: "🎁",
  sparkles: "✨",
};
const ANIMATIONS = new Set(["pop", "slide", "bounce", "shake"]);
export const QUEUE_LIMIT = 10;
export const SHOW_MS = 4500;

export interface AlertView {
  emoji: string;
  title: string;
  name: string | null;
  amount: string | null;
  animation: string;
}

export function alertView(message: OverlayAlertMessage, testTitle = "Test alert"): AlertView | null {
  const a = message.alert;
  if (!a || typeof a.title !== "string") return null;
  return {
    emoji: STICKER_EMOJI[a.sticker] ?? STICKER_EMOJI.heart!,
    title: a.source === "test" ? testTitle : safeText(a.title, 80),
    name: typeof a.name === "string" && a.name ? safeText(a.name, 24) : null,
    amount: typeof a.amount === "string" && a.amount ? safeText(a.amount, 20) : null,
    animation: ANIMATIONS.has(a.animation) ? a.animation : "pop",
  };
}

export function hintTriggers(config: AlertsConfigView | undefined): string[] {
  if (!config?.showHint || !Array.isArray(config.commands)) return [];
  return config.commands
    .map((c) => c.trigger)
    .filter((t) => typeof t === "string" && /^[a-z0-9]{1,20}$/.test(t))
    .slice(0, 6);
}

// Bounded queue: a burst of alerts can't build an endless backlog on stream.
export class AlertQueue<T> {
  private readonly items: T[] = [];
  push(item: T): void {
    if (this.items.length >= QUEUE_LIMIT) this.items.shift();
    this.items.push(item);
  }
  next(): T | undefined {
    return this.items.shift();
  }
  get size(): number {
    return this.items.length;
  }
}
