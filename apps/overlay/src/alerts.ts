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
  paid: boolean;
  emoji: string;
  title: string;
  name: string | null;
  amount: string | null;
  animation: string;
}

export interface AlertDefaults {
  test: string;
  superChat: string;
  membership: string;
}

const FALLBACK: AlertDefaults = { test: "Test alert", superChat: "Thanks for the Super Chat!", membership: "New member!" };

export function alertView(message: OverlayAlertMessage, defaults: AlertDefaults = FALLBACK): AlertView | null {
  const a = message.alert;
  if (!a || typeof a.title !== "string") return null;
  const own = safeText(a.title, 120);
  const title =
    a.source === "test" ? defaults.test : own || (a.source === "super_chat" ? defaults.superChat : a.source === "membership" ? defaults.membership : "");
  if (!title) return null;
  return {
    paid: a.source === "super_chat" || a.source === "membership",
    emoji: STICKER_EMOJI[a.sticker] ?? STICKER_EMOJI.heart!,
    title,
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

// Bounded queue: a burst can't build an endless backlog. When full, free command alerts are dropped before paid ones.
export class AlertQueue<T> {
  private readonly items: T[] = [];
  constructor(private readonly isPaid: (item: T) => boolean = () => false) {}
  push(item: T): void {
    if (this.items.length >= QUEUE_LIMIT) {
      const free = this.items.findIndex((i) => !this.isPaid(i));
      if (free >= 0) this.items.splice(free, 1);
      else if (this.isPaid(item)) this.items.shift();
      else return;
    }
    this.items.push(item);
  }
  next(): T | undefined {
    return this.items.shift();
  }
  get size(): number {
    return this.items.length;
  }
}
