import { describe, expect, it } from "vitest";
import { safeText } from "./render";

describe("safeText", () => {
  it("keeps HTML as literal text (rendering uses textContent)", () => {
    expect(safeText("<img src=x onerror=alert(1)>")).toBe("<img src=x onerror=alert(1)>");
  });

  it("strips bidi overrides and control characters", () => {
    expect(safeText("abc‮dcba⁦x\u0007")).toBe("abcdcbax");
  });

  it("normalises Vietnamese to NFC", () => {
    const decomposed = "Việt Nam";
    expect(safeText(decomposed)).toBe("Việt Nam");
  });

  it("caps very long names without splitting surrogate pairs", () => {
    const out = safeText("😀".repeat(200), 10);
    expect(Array.from(out)).toHaveLength(10);
    expect(out.endsWith("…")).toBe(true);
  });
});
