import { parseAlertsConfig, type AlertsConfig } from "./alerts";

export const WIDGETS = ["poll", "leaderboard", "game", "alerts"] as const;
export type Widget = (typeof WIDGETS)[number];

// Fixed choices only: the overlay maps each key to CSS it owns, so no creator input ever becomes CSS (non-negotiable 5).
export const PRESETS = ["night", "day", "neon", "pastel"] as const;
export const ACCENTS = ["pink", "orange", "yellow", "green", "teal", "blue", "purple", "red"] as const;
export const POSITIONS = ["top-left", "top-right", "bottom-left", "bottom-right", "center"] as const;

export interface WidgetTheme {
  preset: (typeof PRESETS)[number];
  accent: (typeof ACCENTS)[number];
  fontScale: number;
  position: (typeof POSITIONS)[number];
  opacity: number;
  showTitle: boolean;
  showTotal: boolean;
  showNames: boolean;
}

export interface WidgetConfig {
  theme: WidgetTheme;
  alerts?: AlertsConfig;
}

export const DEFAULT_THEME: WidgetTheme = {
  preset: "night",
  accent: "pink",
  fontScale: 100,
  position: "top-left",
  opacity: 72,
  showTitle: true,
  showTotal: true,
  showNames: true,
};

// Different corners by default, so the one-link scene doesn't stack every widget in the same place.
export const DEFAULT_POSITION: Record<Widget, WidgetTheme["position"]> = {
  poll: "top-left",
  leaderboard: "top-right",
  game: "top-left",
  alerts: "bottom-right",
};

export const isWidget = (value: unknown): value is Widget => WIDGETS.includes(value as Widget);

const pick = <T extends string>(allowed: readonly T[], value: unknown, fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);
const stepped = (value: unknown, min: number, max: number, step: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value / step) * step)) : fallback;
const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);

// Lenient by design: unknown keys are dropped and bad values fall back, so stored configs survive future changes.
export function parseWidgetConfig(input: unknown, widget?: Widget): WidgetConfig {
  const raw = (typeof input === "object" && input !== null ? input : {}) as { theme?: Record<string, unknown>; alerts?: unknown };
  const t = typeof raw.theme === "object" && raw.theme !== null ? raw.theme : {};
  return {
    theme: {
      preset: pick(PRESETS, t.preset, DEFAULT_THEME.preset),
      accent: pick(ACCENTS, t.accent, DEFAULT_THEME.accent),
      fontScale: stepped(t.fontScale, 75, 150, 5, DEFAULT_THEME.fontScale),
      position: pick(POSITIONS, t.position, widget ? DEFAULT_POSITION[widget] : DEFAULT_THEME.position),
      opacity: stepped(t.opacity, 0, 100, 5, DEFAULT_THEME.opacity),
      showTitle: bool(t.showTitle, DEFAULT_THEME.showTitle),
      showTotal: bool(t.showTotal, DEFAULT_THEME.showTotal),
      showNames: bool(t.showNames, DEFAULT_THEME.showNames),
    },
    ...(widget === "alerts" && { alerts: parseAlertsConfig(raw.alerts) }),
  };
}
