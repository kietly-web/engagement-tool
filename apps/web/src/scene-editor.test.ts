import { describe, expect, it } from "vitest";
import { clampX, clampY, readEditorMessage } from "./scene-editor";

describe("readEditorMessage", () => {
  it("accepts moves, selections and ready from the scene iframe", () => {
    expect(readEditorMessage({ type: "et-layout-move", widget: "leaderboard", x: 1280, y: 0 })).toEqual({ type: "et-layout-move", widget: "leaderboard", x: 1280, y: 0 });
    expect(readEditorMessage({ type: "et-layout-select", widget: "poll" })).toEqual({ type: "et-layout-select", widget: "poll" });
    expect(readEditorMessage({ type: "et-layout-ready" })).toEqual({ type: "et-layout-ready" });
  });

  it("ignores anything else", () => {
    for (const bad of [undefined, "x", { type: "et-layout-theme", widget: "poll", theme: {} }, { type: "et-layout-move", widget: "game", x: 0, y: 0 }, { type: "et-layout-move", widget: "poll", x: 1921, y: 0 }])
      expect(readEditorMessage(bad)).toBeNull();
  });
});

describe("clamp", () => {
  it("keeps typed coordinates on the canvas", () => {
    expect([clampX(-5), clampX(2500), clampX(12.4), clampY(Number.NaN), clampY(1081)]).toEqual([0, 1600, 12, 0, 1000]);
  });
});
