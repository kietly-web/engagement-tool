import { commandKey, toNfc } from "./text";
import { isChannelId } from "./viewer";

export const STICKERS = ["heart", "fire", "clap", "star", "laugh", "wave", "gift", "sparkles"] as const;
export const ANIMATIONS = ["pop", "slide", "bounce", "shake"] as const;
export type Sticker = (typeof STICKERS)[number];
export type Animation = (typeof ANIMATIONS)[number];

export const ALERT_LIMITS = {
  maxCommands: 20,
  maxTriggerLength: 20,
  maxTextLength: 80,
  queueLength: 10,
} as const;

// Built-in commands keep their meaning; a creator trigger may not shadow them.
const RESERVED = new Set(["vote", "v", "binhchon", "chon", "bc", "join", "thamgia", "tg", "guess", "doan", "points", "diem"]);

export interface AlertCommand {
  trigger: string;
  text: string;
  sticker: Sticker;
  animation: Animation;
}

export interface AlertsConfig {
  commands: AlertCommand[];
  viewerCooldownSeconds: number;
  globalCooldownSeconds: number;
  showHint: boolean;
}

export const DEFAULT_ALERTS: AlertsConfig = { commands: [], viewerCooldownSeconds: 30, globalCooldownSeconds: 3, showHint: true };

const pick = <T extends string>(allowed: readonly T[], v: unknown, d: T): T => (allowed.includes(v as T) ? (v as T) : d);
const int = (v: unknown, min: number, max: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : d);

export function normaliseTrigger(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const key = commandKey(raw.startsWith("!") ? raw : `!${raw}`).slice(1);
  return /^[a-z0-9]{1,20}$/.test(key) && !RESERVED.has(key) ? key : null;
}

function cleanText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = toNfc(raw).replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/\s+/gu, " ").trim();
  const chars = Array.from(text);
  return chars.length === 0 ? null : chars.slice(0, ALERT_LIMITS.maxTextLength).join("");
}

// Lenient like the theme parser: invalid or duplicate commands are dropped, not rejected.
export function parseAlertsConfig(input: unknown): AlertsConfig {
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const commands: AlertCommand[] = [];
  for (const c of Array.isArray(raw.commands) ? raw.commands : []) {
    if (commands.length >= ALERT_LIMITS.maxCommands) break;
    const r = (typeof c === "object" && c !== null ? c : {}) as Record<string, unknown>;
    const trigger = normaliseTrigger(r.trigger);
    const text = cleanText(r.text);
    if (!trigger || !text || seen.has(trigger)) continue;
    seen.add(trigger);
    commands.push({ trigger, text, sticker: pick(STICKERS, r.sticker, "heart"), animation: pick(ANIMATIONS, r.animation, "pop") });
  }
  return {
    commands,
    viewerCooldownSeconds: int(raw.viewerCooldownSeconds, 5, 600, DEFAULT_ALERTS.viewerCooldownSeconds),
    globalCooldownSeconds: int(raw.globalCooldownSeconds, 1, 60, DEFAULT_ALERTS.globalCooldownSeconds),
    showHint: typeof raw.showHint === "boolean" ? raw.showHint : DEFAULT_ALERTS.showHint,
  };
}

export function matchAlertCommand(text: string, commands: readonly AlertCommand[]): AlertCommand | null {
  const key = commandKey(text);
  if (!key.startsWith("!")) return null;
  const word = key.slice(1).split(" ", 1)[0] ?? "";
  return commands.find((c) => c.trigger === word) ?? null;
}

export type AlertSource = "command" | "super_chat" | "membership" | "test";

export interface AlertEvent {
  source: AlertSource;
  title: string;
  name: string | null;
  sticker: Sticker;
  animation: Animation;
  amount?: string;
}

// Cooldowns keep one viewer, or a flood of viewers, from turning the overlay into a spam channel.
export class AlertThrottle {
  private lastGlobal = Number.NEGATIVE_INFINITY;
  private readonly lastByViewer = new Map<string, number>();

  allow(channelId: string, nowMs: number, config: Pick<AlertsConfig, "viewerCooldownSeconds" | "globalCooldownSeconds">): boolean {
    if (!isChannelId(channelId)) return false;
    if (nowMs - this.lastGlobal < config.globalCooldownSeconds * 1000) return false;
    const last = this.lastByViewer.get(channelId);
    if (last !== undefined && nowMs - last < config.viewerCooldownSeconds * 1000) return false;
    this.lastGlobal = nowMs;
    if (this.lastByViewer.size >= 5_000) this.lastByViewer.delete(this.lastByViewer.keys().next().value!);
    this.lastByViewer.set(channelId, nowMs);
    return true;
  }

  forget(channelId: string): void {
    this.lastByViewer.delete(channelId);
  }

  reset(): void {
    this.lastGlobal = Number.NEGATIVE_INFINITY;
    this.lastByViewer.clear();
  }
}
