import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, isWidget, parseWidgetConfig } from "./widget-config";

describe("parseWidgetConfig", () => {
  it("puts each widget in its own corner unless the creator chose one", () => {
    expect(parseWidgetConfig({}, "poll").theme.position).toBe("top-left");
    expect(parseWidgetConfig({}, "leaderboard").theme.position).toBe("top-right");
    expect(parseWidgetConfig({}, "alerts").theme.position).toBe("bottom-right");
    expect(parseWidgetConfig({ theme: { position: "center" } }, "alerts").theme.position).toBe("center");
  });

  it("fills defaults for missing or broken input", () => {
    for (const input of [undefined, null, 42, "x", {}, { theme: "x" }]) expect(parseWidgetConfig(input)).toEqual({ theme: DEFAULT_THEME });
  });

  it("keeps valid choices and snaps numbers into range", () => {
    const config = parseWidgetConfig({ theme: { preset: "neon", accent: "teal", fontScale: 133, position: "center", opacity: 7, showNames: false } });
    expect(config.theme).toEqual({ ...DEFAULT_THEME, preset: "neon", accent: "teal", fontScale: 135, position: "center", opacity: 5, showNames: false });
    expect(parseWidgetConfig({ theme: { fontScale: 999, opacity: -50 } }).theme).toMatchObject({ fontScale: 150, opacity: 0 });
  });

  it("never lets free text through as a style value", () => {
    const hostile = { theme: { preset: "night;}body{display:none", accent: '#fff" onload=', position: "url(javascript:x)", extra: "<script>" } };
    const config = parseWidgetConfig(hostile);
    expect(config.theme).toEqual(DEFAULT_THEME);
    expect(JSON.stringify(config)).not.toMatch(/script|javascript|display/);
  });

  it("recognises widgets", () => {
    expect(["poll", "leaderboard", "game", "alerts"].every(isWidget)).toBe(true);
    expect(isWidget("chat")).toBe(false);
  });
});
