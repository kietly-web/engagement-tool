import { CANVAS } from "./theme";

export type EditableWidget = "poll" | "leaderboard" | "alerts";
const EDITABLE: readonly EditableWidget[] = ["poll", "leaderboard", "alerts"];

const GRID = 10;
const SNAP = 16;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function snapAxis(value: number, size: number, limit: number): number {
  const max = Math.max(0, limit - size);
  const clamped = Math.min(max, Math.max(0, value));
  const centre = (limit - size) / 2;
  for (const target of [0, max, centre]) if (Math.abs(clamped - target) <= SNAP) return Math.round(Math.max(0, target));
  return Math.min(max, Math.round(clamped / GRID) * GRID);
}

// Keeps the whole widget on the canvas and snaps it to the edges, the centre lines and a 10 px grid.
export function dragTo(start: Box, dx: number, dy: number): { x: number; y: number } {
  return { x: snapAxis(start.x + dx, start.width, CANVAS.width), y: snapAxis(start.y + dy, start.height, CANVAS.height) };
}

// The editor page and the dashboard talk over postMessage on one origin; both sides accept only these shapes.
export type EditorMessage =
  | { type: "et-layout-theme"; widget: EditableWidget; theme: unknown; display?: unknown }
  | { type: "et-layout-select"; widget: EditableWidget }
  | { type: "et-layout-move"; widget: EditableWidget; x: number; y: number }
  | { type: "et-layout-ready" };

const isEditable = (v: unknown): v is EditableWidget => EDITABLE.includes(v as EditableWidget);
const isCoord = (v: unknown, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;

export function parseEditorMessage(data: unknown): EditorMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const m = data as Record<string, unknown>;
  switch (m.type) {
    case "et-layout-ready":
      return { type: "et-layout-ready" };
    case "et-layout-theme":
      return isEditable(m.widget) ? { type: "et-layout-theme", widget: m.widget, theme: m.theme, display: m.display } : null;
    case "et-layout-select":
      return isEditable(m.widget) ? { type: "et-layout-select", widget: m.widget } : null;
    case "et-layout-move":
      return isEditable(m.widget) && isCoord(m.x, CANVAS.width) && isCoord(m.y, CANVAS.height) ? { type: "et-layout-move", widget: m.widget, x: m.x, y: m.y } : null;
    default:
      return null;
  }
}
