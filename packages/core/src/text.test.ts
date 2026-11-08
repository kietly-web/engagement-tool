import { describe, expect, it } from "vitest";
import { commandKey, foldVietnamese, MAX_SCAN_LENGTH, toNfc } from "./text";

describe("foldVietnamese", () => {
  it.each([
    ["bình chọn", "binh chon"],
    ["Tham gia điểm danh", "Tham gia diem danh"],
    ["ĐỘI MẠNH NHẤT", "DOI MANH NHAT"],
    ["ă â ê ô ơ ư", "a a e o o u"],
  ])("%s → %s", (input, expected) => {
    expect(foldVietnamese(input)).toBe(expected);
  });

  it("folds decomposed (NFD) input the same as composed", () => {
    expect(foldVietnamese("bi\u0300nh cho\u0323n")).toBe("binh chon");
  });
});

describe("toNfc", () => {
  it("composes decomposed Vietnamese", () => {
    expect(toNfc("Vie\u0323\u0302t")).toBe("Việt");
  });
});

describe("commandKey", () => {
  it("folds full-width forms and ideographic spaces", () => {
    expect(commandKey("！ＶＯＴＥ\u3000２")).toBe("!vote 2");
  });

  it("drops zero-width and bidi format characters", () => {
    expect(commandKey("\u202E!vo\u200Bte\u2066 2")).toBe("!vote 2");
  });

  it("strips zalgo marks", () => {
    expect(commandKey("!v\u0337o\u0338t\u0335e 2")).toBe("!vote 2");
  });

  it("collapses whitespace runs", () => {
    expect(commandKey("  !bình   chọn \t 2 ")).toBe("!binh chon 2");
  });

  it("keeps other scripts' digits as they are", () => {
    expect(commandKey("!vote ٢")).toBe("!vote ٢");
  });

  it("scans a bounded prefix of very long input", () => {
    const key = commandKey("!vote 2 " + "a".repeat(100_000));
    expect(key.length).toBeLessThanOrEqual(MAX_SCAN_LENGTH);
    expect(key.startsWith("!vote 2")).toBe(true);
  });
});
