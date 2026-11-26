import type { OverlayTheme, WidgetDisplayView } from "@et/worker/api-types";
import { safeText } from "./render";

const PRESETS = ["night", "day", "neon", "pastel"] as const;
const ACCENTS = ["pink", "orange", "yellow", "green", "teal", "blue", "purple", "red"] as const;
const POSITIONS = ["top-left", "top-right", "bottom-left", "bottom-right", "center", "custom"] as const;
export const CANVAS = { width: 1920, height: 1080 } as const;

export const DEFAULT_THEME: OverlayTheme = {
  preset: "night",
  accent: "pink",
  fontScale: 100,
  position: "top-left",
  x: 0,
  y: 0,
  width: 640,
  opacity: 72,
  showTitle: true,
  showTotal: true,
  showNames: true,
  accentColor: "",
};

export const DEFAULT_DISPLAY: WidgetDisplayView = { pollNumbers: "percent", rows: 10, title: "", pointsWord: "", anonymousName: "", alertSeconds: 4.5 };
const HEX = /^#[0-9a-f]{6}$/;

const pick = <T extends string>(allowed: readonly T[], v: unknown, d: T): T => (allowed.includes(v as T) ? (v as T) : d);
const clamp = (v: unknown, min: number, max: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d);
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);

// The server already validates; this second pass means only fixed keys and clamped numbers ever touch the DOM.
export function themeFrom(config: unknown): OverlayTheme {
  const t = (config as { theme?: Record<string, unknown> } | null)?.theme ?? {};
  return {
    preset: pick(PRESETS, t.preset, DEFAULT_THEME.preset),
    accent: pick(ACCENTS, t.accent, DEFAULT_THEME.accent),
    fontScale: clamp(t.fontScale, 75, 150, DEFAULT_THEME.fontScale),
    position: pick(POSITIONS, t.position, DEFAULT_THEME.position),
    x: Math.round(clamp(t.x, 0, CANVAS.width, 0)),
    y: Math.round(clamp(t.y, 0, CANVAS.height, 0)),
    width: Math.round(clamp(t.width, 320, 1200, DEFAULT_THEME.width)),
    opacity: clamp(t.opacity, 0, 100, DEFAULT_THEME.opacity),
    showTitle: bool(t.showTitle, true),
    showTotal: bool(t.showTotal, true),
    showNames: bool(t.showNames, true),
    accentColor: typeof t.accentColor === "string" && HEX.test(t.accentColor) ? t.accentColor : "",
  };
}

const plain = (v: unknown, max: number) => (typeof v === "string" ? safeText(v.slice(0, max * 4).replace(/\p{Sc}/gu, ""), max) : "");
// Mirrors the server's list; the overlay never shows a unit that reads as money.
const MONEY = new Set(["d", "dong", "vnd", "usd", "tien", "xu", "k", "nghin", "ngan", "trieu", "coin", "cash", "money"]);
const moneyFree = (w: string) => (MONEY.has(w.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z]/g, "")) ? "" : w);

// Older OBS browser sources predate color-mix(), so the lighter second colour is computed here.
export function lighten(hex: string, amount = 0.45): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => mix(c).toString(16).padStart(2, "0")).join("")}`;
}

export function displayFrom(config: unknown): WidgetDisplayView {
  const d = (config as { display?: Record<string, unknown> } | null)?.display ?? {};
  return {
    pollNumbers: pick(["percent", "votes", "both"] as const, d.pollNumbers, DEFAULT_DISPLAY.pollNumbers),
    rows: Math.round(clamp(d.rows, 3, 10, DEFAULT_DISPLAY.rows)),
    title: plain(d.title, 40),
    pointsWord: moneyFree(plain(d.pointsWord, 12)),
    anonymousName: plain(d.anonymousName, 12),
    alertSeconds: clamp(d.alertSeconds, 2, 10, DEFAULT_DISPLAY.alertSeconds),
  };
}

export function applyTheme(panel: HTMLElement, theme: OverlayTheme): void {
  panel.dataset.preset = theme.preset;
  panel.dataset.accent = theme.accent;
  panel.style.setProperty("--scale", String(theme.fontScale / 100));
  panel.style.setProperty("--width", `${theme.width}px`);
  panel.style.setProperty("--bg-alpha", String(theme.opacity / 100));
  panel.classList.toggle("hide-title", !theme.showTitle);
  panel.classList.toggle("hide-total", !theme.showTotal);
  // Only a validated #rrggbb reaches CSS; anything else leaves the preset's colours in place.
  if (HEX.test(theme.accentColor)) {
    panel.style.setProperty("--accent", theme.accentColor);
    panel.style.setProperty("--accent2", lighten(theme.accentColor));
  } else {
    panel.style.removeProperty("--accent");
    panel.style.removeProperty("--accent2");
  }
}

export function decodePreview(hash: string): unknown {
  try {
    const b64 = hash.replace(/^#/, "").replace(/-/g, "+").replace(/_/g, "/");
    if (!b64 || b64.length > 4000) return {};
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
  } catch {
    return {};
  }
}
