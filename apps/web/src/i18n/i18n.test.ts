import { describe, expect, it } from "vitest";
import { en } from "./en";
import { translator } from "./index";
import { vi } from "./vi";

describe("message catalogs", () => {
  it("have the same keys in every locale", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(vi).sort());
  });

  it("store Vietnamese in NFC so comparisons and fonts behave", () => {
    for (const value of Object.values(vi)) {
      expect(value).toBe(value.normalize("NFC"));
    }
  });

  it("defaults to Vietnamese copy", () => {
    expect(translator("vi")("health.ok")).toBe("Máy chủ đang hoạt động");
  });
});
