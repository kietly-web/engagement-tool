import { describe, expect, it } from "vitest";
import { dragTo, parseEditorMessage } from "./layout";

const box = { x: 100, y: 100, width: 640, height: 300 };

describe("dragTo", () => {
  it("moves by the drag distance on a 10 px grid", () => {
    expect(dragTo(box, 203, 147)).toEqual({ x: 300, y: 250 });
  });

  it("keeps the whole widget on the canvas", () => {
    expect(dragTo(box, -500, -500)).toEqual({ x: 0, y: 0 });
    expect(dragTo(box, 5000, 5000)).toEqual({ x: 1280, y: 780 });
  });

  it("snaps to edges and the centre lines", () => {
    expect(dragTo(box, -90, -88)).toEqual({ x: 0, y: 0 });
    expect(dragTo(box, 1175, 0).x).toBe(1280);
    expect(dragTo(box, 545, 290)).toEqual({ x: 640, y: 390 });
  });
});

describe("parseEditorMessage", () => {
  it("accepts only known shapes", () => {
    expect(parseEditorMessage({ type: "et-layout-move", widget: "poll", x: 10, y: 20 })).toEqual({ type: "et-layout-move", widget: "poll", x: 10, y: 20 });
    expect(parseEditorMessage({ type: "et-layout-select", widget: "alerts" })).toEqual({ type: "et-layout-select", widget: "alerts" });
    expect(parseEditorMessage({ type: "et-layout-ready", extra: "<b>" })).toEqual({ type: "et-layout-ready" });
  });

  it("rejects other widgets, odd numbers and junk", () => {
    for (const bad of [
      null,
      "et-layout-ready",
      { type: "et-layout-move", widget: "scene", x: 1, y: 1 },
      { type: "et-layout-move", widget: "poll", x: 1.5, y: 1 },
      { type: "et-layout-move", widget: "poll", x: -1, y: 1 },
      { type: "et-layout-move", widget: "poll", x: 1, y: 2000 },
      { type: "et-layout-move", widget: "poll", x: "1", y: 1 },
      { type: "eval", widget: "poll" },
    ])
      expect(parseEditorMessage(bad)).toBeNull();
  });
});
