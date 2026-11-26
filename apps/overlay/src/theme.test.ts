import { describe, expect, it } from "vitest";
import { decodePreview, DEFAULT_THEME, themeFrom } from "./theme";

const encode = (v: unknown) => "#" + btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(v)))).replace(/\+/g, "-").replace(/\//g, "_");

describe("themeFrom", () => {
  it("accepts only fixed choices and clamps numbers", () => {
    expect(themeFrom({ theme: { preset: "day", accent: "teal", fontScale: 400, opacity: -3, position: "center" } })).toEqual({
      ...DEFAULT_THEME,
      preset: "day",
      accent: "teal",
      fontScale: 150,
      opacity: 0,
      position: "center",
    });
    expect(themeFrom({ theme: { preset: "x;}body{}", accent: "url(evil)" } })).toEqual(DEFAULT_THEME);
    expect(themeFrom(null)).toEqual(DEFAULT_THEME);
  });
});

describe("decodePreview", () => {
  it("round-trips Vietnamese JSON and survives garbage", () => {
    expect(decodePreview(encode({ theme: { preset: "neon" }, note: "Xin chào" }))).toEqual({ theme: { preset: "neon" }, note: "Xin chào" });
    expect(decodePreview("#%%%")).toEqual({});
    expect(decodePreview("#" + "A".repeat(5000))).toEqual({});
  });
});

describe("displayFrom and the custom accent", () => {
  it("keeps only safe display values and a strict #rrggbb colour", async () => {
    const { displayFrom, themeFrom } = await import("./theme");
    expect(displayFrom({ display: { pollNumbers: "both", rows: 4, title: "Top\u202E fan", pointsWord: "tim", anonymousName: "Bạn", alertSeconds: 7 } })).toEqual({
      pollNumbers: "both",
      rows: 4,
      title: "Top fan",
      pointsWord: "tim",
      anonymousName: "Bạn",
      alertSeconds: 7,
    });
    expect(displayFrom({ display: { pollNumbers: "<b>", rows: 99, title: 5, alertSeconds: -1 } })).toMatchObject({ pollNumbers: "percent", rows: 10, title: "", alertSeconds: 2 });
    expect(themeFrom({ theme: { accentColor: "#a1b2c3" } }).accentColor).toBe("#a1b2c3");
    for (const money of ["VNĐ", "đ", "$", "xu", "Tiền", "usd"]) expect(displayFrom({ display: { pointsWord: money } }).pointsWord, money).toBe("");
    expect(displayFrom({ display: { title: "Top 3 nhận 50$" } }).title).toBe("Top 3 nhận 50");
    const { lighten } = await import("./theme");
    expect(lighten("#000000")).toBe("#737373");
    expect(lighten("#ff4f7b")).toBe("#ff9eb6");
    for (const bad of ["#A1B2C3;x", "red", "url(x)", "#fff"]) expect(themeFrom({ theme: { accentColor: bad } }).accentColor).toBe("");
  });
});
