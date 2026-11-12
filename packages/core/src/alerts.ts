import { parseCommand } from "./commands";
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
const RESERVED = new Set(["vote", "v", "binhchon", "binh", "chon", "bc", "join", "thamgia", "tham", "tg", "guess", "doan", "points", "diem"]);

// Also rejects keys a built-in would claim or half-claim (e.g. "vote1", "v0"), which would never fire or misfire.
const clashesWithBuiltIn = (key: string) =>
  RESERVED.has(key) || parseCommand(`!${key}`) !== null || parseCommand(`!${key} 1`) !== null || /^(?:vote|v|bc|chon|binhchon)\d+$/.test(key);

export interface AlertCommand {
  trigger: string;
  text: string;
  sticker: Sticker;
  animation: Animation;
}

export interface DonationAlertSettings {
  superChats: boolean;
  memberships: boolean;
  showAmount: boolean;
  showComment: boolean;
}

export interface AlertsConfig {
  commands: AlertCommand[];
  viewerCooldownSeconds: number;
  globalCooldownSeconds: number;
  showHint: boolean;
  donations: DonationAlertSettings;
}

export const DEFAULT_DONATIONS: DonationAlertSettings = { superChats: true, memberships: true, showAmount: true, showComment: true };

export const DEFAULT_ALERTS: AlertsConfig = {
  commands: [],
  viewerCooldownSeconds: 30,
  globalCooldownSeconds: 3,
  showHint: true,
  donations: DEFAULT_DONATIONS,
};

const pick = <T extends string>(allowed: readonly T[], v: unknown, d: T): T => (allowed.includes(v as T) ? (v as T) : d);
const int = (v: unknown, min: number, max: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : d);

export function normaliseTrigger(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const key = commandKey(raw.startsWith("!") ? raw : `!${raw}`).slice(1);
  return /^[a-z0-9]{1,20}$/.test(key) && !clashesWithBuiltIn(key) ? key : null;
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
    donations: parseDonations(raw.donations),
  };
}

function parseDonations(input: unknown): DonationAlertSettings {
  const d = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const b = (k: keyof DonationAlertSettings) => (typeof d[k] === "boolean" ? (d[k] as boolean) : DEFAULT_DONATIONS[k]);
  return { superChats: b("superChats"), memberships: b("memberships"), showAmount: b("showAmount"), showComment: b("showComment") };
}

function cleanAmount(raw: string): string | null {
  const text = cleanText(raw);
  return text ? Array.from(text).slice(0, 20).join("") : null;
}

const DONATION_STICKER: Record<string, Sticker> = { super_chat: "gift", super_sticker: "sparkles", membership: "star", membership_gift: "gift" };

// Donations never earn points or touch polls (ADR-008, non-negotiable 6); this only decides what is drawn.
export function donationAlert(
  donation: { kind: "super_chat" | "super_sticker" | "membership" | "membership_gift"; amount: string | null; comment: string },
  name: string | null,
  settings: DonationAlertSettings,
): AlertEvent | null {
  const isMembership = donation.kind === "membership" || donation.kind === "membership_gift";
  if (isMembership ? !settings.memberships : !settings.superChats) return null;
  const comment = settings.showComment ? (cleanText(donation.comment) ?? "") : "";
  return {
    source: isMembership ? "membership" : "super_chat",
    title: comment,
    name,
    sticker: DONATION_STICKER[donation.kind] ?? "gift",
    animation: "bounce",
    ...(settings.showAmount && donation.amount && cleanAmount(donation.amount) ? { amount: cleanAmount(donation.amount)! } : {}),
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
