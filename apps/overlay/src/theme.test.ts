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
