import type { OverlayTheme, SceneEditorMessage, SceneEditorWidget } from "@et/worker/api-types";

export const SCENE_WIDGETS: readonly SceneEditorWidget[] = ["poll", "leaderboard", "alerts"];
export const CANVAS = { width: 1920, height: 1080 } as const;
export const DEFAULT_CORNER: Record<SceneEditorWidget, OverlayTheme["position"]> = { poll: "top-left", leaderboard: "top-right", alerts: "bottom-right" };

const isWidget = (v: unknown): v is SceneEditorWidget => SCENE_WIDGETS.includes(v as SceneEditorWidget);
const isCoord = (v: unknown, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;

// Only messages the scene iframe sends are accepted; the caller also checks origin and source.
export function readEditorMessage(data: unknown): Exclude<SceneEditorMessage, { type: "et-layout-theme" }> | null {
  if (typeof data !== "object" || data === null) return null;
  const m = data as Record<string, unknown>;
  if (m.type === "et-layout-ready") return { type: "et-layout-ready" };
  if (m.type === "et-layout-select" && isWidget(m.widget)) return { type: "et-layout-select", widget: m.widget };
  if (m.type === "et-layout-move" && isWidget(m.widget) && isCoord(m.x, CANVAS.width) && isCoord(m.y, CANVAS.height)) return { type: "et-layout-move", widget: m.widget, x: m.x, y: m.y };
  return null;
}

const clampInt = (value: number, min: number, max: number) => (Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : min);

export const clampX = (value: number) => clampInt(value, 0, CANVAS.width - 320);
export const clampY = (value: number) => clampInt(value, 0, CANVAS.height - 80);
