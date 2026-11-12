import type { OverlayTheme } from "@et/worker/api-types";

const PRESETS = ["night", "day", "neon", "pastel"] as const;
const ACCENTS = ["pink", "orange", "yellow", "green", "teal", "blue", "purple", "red"] as const;
const POSITIONS = ["top-left", "top-right", "bottom-left", "bottom-right", "center"] as const;

export const DEFAULT_THEME: OverlayTheme = {
  preset: "night",
  accent: "pink",
  fontScale: 100,
  position: "top-left",
  opacity: 72,
  showTitle: true,
  showTotal: true,
  showNames: true,
};

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
    opacity: clamp(t.opacity, 0, 100, DEFAULT_THEME.opacity),
    showTitle: bool(t.showTitle, true),
    showTotal: bool(t.showTotal, true),
    showNames: bool(t.showNames, true),
  };
}

export function applyTheme(panel: HTMLElement, theme: OverlayTheme): void {
  panel.dataset.preset = theme.preset;
  panel.dataset.accent = theme.accent;
  panel.style.setProperty("--scale", String(theme.fontScale / 100));
  panel.style.setProperty("--bg-alpha", String(theme.opacity / 100));
  panel.classList.toggle("hide-title", !theme.showTitle);
  panel.classList.toggle("hide-total", !theme.showTotal);
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
