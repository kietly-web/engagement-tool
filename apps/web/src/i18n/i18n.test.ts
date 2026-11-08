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

  it("has copy for every sign-in outcome the API can report", () => {
    const outcomes = ["denied", "state", "google", "youtube_denied", "no_refresh_token", "no_channel", "youtube_error", "channel_in_use"];
    for (const o of outcomes) expect(Object.keys(vi)).toContain(`signin.outcome.${o}`);
  });

  it("defaults to Vietnamese copy", () => {
    expect(translator("vi")("health.ok")).toBe("Máy chủ đang hoạt động");
  });
});
