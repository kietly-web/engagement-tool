import { describe, expect, it } from "vitest";
import { DEFAULT_DISPLAY, DEFAULT_THEME, isWidget, parseWidgetConfig } from "./widget-config";

describe("parseWidgetConfig", () => {
  it("puts each widget in its own corner unless the creator chose one", () => {
    expect(parseWidgetConfig({}, "poll").theme.position).toBe("top-left");
    expect(parseWidgetConfig({}, "leaderboard").theme.position).toBe("top-right");
    expect(parseWidgetConfig({}, "alerts").theme.position).toBe("bottom-right");
    expect(parseWidgetConfig({ theme: { position: "center" } }, "alerts").theme.position).toBe("center");
  });

  it("fills defaults for missing or broken input", () => {
    for (const input of [undefined, null, 42, "x", {}, { theme: "x" }]) expect(parseWidgetConfig(input)).toEqual({ theme: DEFAULT_THEME, display: DEFAULT_DISPLAY });
  });

  it("keeps valid choices and snaps numbers into range", () => {
    const config = parseWidgetConfig({ theme: { preset: "neon", accent: "teal", fontScale: 133, position: "center", opacity: 7, showNames: false } });
    expect(config.theme).toEqual({ ...DEFAULT_THEME, preset: "neon", accent: "teal", fontScale: 135, position: "center", opacity: 5, showNames: false });
    expect(parseWidgetConfig({ theme: { fontScale: 999, opacity: -50 } }).theme).toMatchObject({ fontScale: 150, opacity: 0 });
  });

  it("keeps a dragged position on the 1920×1080 canvas as whole pixels", () => {
    expect(parseWidgetConfig({ theme: { position: "custom", x: 812.6, y: 400, width: 455 } }, "poll").theme).toMatchObject({ position: "custom", x: 813, y: 400, width: 460 });
    expect(parseWidgetConfig({ theme: { x: 5000, y: 5000, width: 10_000 } }).theme).toMatchObject({ x: 1600, y: 1000, width: 1200 });
    expect(parseWidgetConfig({ theme: { x: "100", y: Number.NaN, width: null } }).theme).toMatchObject({ x: 0, y: 0, width: 640 });
  });

  it("never lets free text through as a style value", () => {
    const hostile = {
      theme: { preset: "night;}body{display:none", accent: '#fff" onload=', accentColor: "red;background:url(x)", position: "url(javascript:x)", extra: "<script>" },
      display: { pollNumbers: "<b>", rows: "9;", alertSeconds: "1e9" },
    };
    const config = parseWidgetConfig(hostile);
    expect(config.theme).toEqual(DEFAULT_THEME);
    expect(config.display).toEqual(DEFAULT_DISPLAY);
    expect(JSON.stringify(config)).not.toMatch(/script|javascript|display:none|url\(/);
  });

  it("accepts only an exact #rrggbb accent colour", () => {
    expect(parseWidgetConfig({ theme: { accentColor: "#12AB9f" } }).theme.accentColor).toBe("#12ab9f");
    for (const bad of ["#fff", "12ab9f", "#12ab9fz", "rgb(1,2,3)", "#12ab9f;x", 12]) expect(parseWidgetConfig({ theme: { accentColor: bad } }).theme.accentColor).toBe("");
  });

  it("keeps the creator's display text short and plain, and snaps numbers", () => {
    const d = parseWidgetConfig({
      display: { pollNumbers: "both", rows: 4.6, title: "  Top\u202E fan   \u0000tuần này  ", pointsWord: "tim vàng lấp lánh siêu dài", anonymousName: "Bạn ẩn", alertSeconds: 6.3 },
    }).display;
    expect(d).toEqual({ pollNumbers: "both", rows: 5, title: "Top fan tuần này", pointsWord: "tim vàng lấp", anonymousName: "Bạn ẩn", alertSeconds: 6.5 });
    expect(parseWidgetConfig({ display: { rows: 50, alertSeconds: 0 } }).display).toMatchObject({ rows: 10, alertSeconds: 2 });
  });

  it("never lets the points word or title read as money", () => {
    for (const money of ["VNĐ", "đ", "đồng", "$", "USD", "xu", "tiền", "k", "triệu"]) expect(parseWidgetConfig({ display: { pointsWord: money } }).display.pointsWord, money).toBe("");
    expect(parseWidgetConfig({ display: { pointsWord: "tim" } }).display.pointsWord).toBe("tim");
    expect(parseWidgetConfig({ display: { title: "Top €100 ¥ fan" } }).display.title).toBe("Top 100 fan");
    expect(parseWidgetConfig({ display: { title: "x".repeat(100_000) } }).display.title).toHaveLength(40);
  });

  it("recognises widgets", () => {
    expect(["poll", "leaderboard", "game", "alerts"].every(isWidget)).toBe(true);
    expect(isWidget("chat")).toBe(false);
  });
});
