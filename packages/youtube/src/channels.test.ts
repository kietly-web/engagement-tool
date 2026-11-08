import { describe, expect, it } from "vitest";
import { CHANNELS_MINE_URL, fetchMyChannel, YoutubeApiError } from "./channels";
import type { FetchLike } from "./http";

const respond = (status: number, body: unknown): FetchLike => async () => ({ ok: status < 400, status, json: async () => body });

describe("fetchMyChannel", () => {
  it("calls the read-only channels endpoint with the bearer token", async () => {
    const calls: [string, unknown][] = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push([url, init]);
      return { ok: true, status: 200, json: async () => ({ items: [{ id: "UCSYNTHxAAAAAAAAAAAAAAAA", snippet: { title: " Kênh Thử " } }] }) };
    };
    expect(await fetchMyChannel("tok", fetchFn)).toEqual({ id: "UCSYNTHxAAAAAAAAAAAAAAAA", title: "Kênh Thử" });
    expect(calls).toEqual([[CHANNELS_MINE_URL, { headers: { Authorization: "Bearer tok" } }]]);
  });

  it("returns null when the account has no channel or the id is malformed", async () => {
    expect(await fetchMyChannel("t", respond(200, { items: [] }))).toBeNull();
    expect(await fetchMyChannel("t", respond(200, {}))).toBeNull();
    expect(await fetchMyChannel("t", respond(200, { items: [{ id: "<script>" }] }))).toBeNull();
  });

  it("falls back to the id when the title is missing and caps long titles", async () => {
    const id = "UCSYNTHxAAAAAAAAAAAAAAAA";
    expect(await fetchMyChannel("t", respond(200, { items: [{ id }] }))).toEqual({ id, title: id });
    const long = await fetchMyChannel("t", respond(200, { items: [{ id, snippet: { title: "x".repeat(500) } }] }));
    expect(long?.title).toHaveLength(200);
  });

  it("throws on API errors", async () => {
    await expect(fetchMyChannel("t", respond(403, {}))).rejects.toBeInstanceOf(YoutubeApiError);
  });
});
