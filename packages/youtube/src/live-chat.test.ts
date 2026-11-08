import { describe, expect, it } from "vitest";
import { ChatSourceError } from "./chat-source";
import type { FetchLike } from "./http";
import { QUOTA_UNITS, toChatMessage, YoutubeChatSource } from "./live-chat";

const ID = "UCSYNTHxAAAAAAAAAAAAAAAA";
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const fail = (status: number, reason?: string) => ({ ok: false, status, json: async () => ({ error: { errors: reason ? [{ reason }] : [] } }) });

function source(respond: (url: string) => ReturnType<FetchLike> | Awaited<ReturnType<FetchLike>>, quota = true) {
  const calls: { url: string; auth?: string }[] = [];
  const reserved: number[] = [];
  const src = new YoutubeChatSource({
    fetch: async (url, init) => {
      calls.push({ url, auth: init?.headers?.Authorization });
      return respond(url);
    },
    accessToken: async () => "at",
    reserveQuota: async (units) => (reserved.push(units), quota),
  });
  return { src, calls, reserved };
}

describe("toChatMessage", () => {
  it("keeps only text messages with valid authors and drops everything else", () => {
    const item = {
      snippet: { type: "textMessageEvent", publishedAt: "2026-11-08T13:00:00Z", textMessageDetails: { messageText: "!vote 2" } },
      authorDetails: { channelId: ID, displayName: "Khán giả", profileImageUrl: "https://example.test/a.png", isChatModerator: true },
    };
    expect(toChatMessage(item)).toEqual({ channelId: ID, displayName: "Khán giả", text: "!vote 2", publishedAt: "2026-11-08T13:00:00Z" });
    expect(toChatMessage({ ...item, snippet: { ...item.snippet, type: "superChatEvent" } })).toBeNull();
    expect(toChatMessage({ ...item, authorDetails: { channelId: "nope" } })).toBeNull();
  });
});

describe("YoutubeChatSource", () => {
  it("finds the active broadcast's chat for 1 unit", async () => {
    const { src, calls, reserved } = source(() => ok({ items: [{ id: "b1", snippet: { liveChatId: "chat-1" } }] }));
    expect(await src.findActiveLiveChat()).toEqual({ broadcastId: "b1", liveChatId: "chat-1" });
    expect(reserved).toEqual([QUOTA_UNITS.liveBroadcastsList]);
    expect(calls[0]!.url).toContain("broadcastStatus=active");
    expect(calls[0]!.auth).toBe("Bearer at");
  });

  it("returns null when nothing is live", async () => {
    expect(await source(() => ok({ items: [] })).src.findActiveLiveChat()).toBeNull();
  });

  it("pages chat, honours the polling interval and debits 5 units per call", async () => {
    const { src, calls, reserved } = source(() =>
      ok({
        nextPageToken: "p2",
        pollingIntervalMillis: 4200,
        items: [{ snippet: { type: "textMessageEvent", displayMessage: "!vote 1" }, authorDetails: { channelId: ID, displayName: "A" } }],
      }),
    );
    const page = await src.fetchPage("chat-1", "p1");
    expect(page).toMatchObject({ nextPageToken: "p2", waitMs: 4200, messages: [{ text: "!vote 1" }] });
    expect(new URL(calls[0]!.url).searchParams.get("pageToken")).toBe("p1");
    expect(reserved).toEqual([QUOTA_UNITS.liveChatMessagesList]);
  });

  it("never polls faster than once a second", async () => {
    expect((await source(() => ok({ pollingIntervalMillis: 10 })).src.fetchPage("c")).waitMs).toBe(1000);
  });

  it("refuses to call YouTube when the quota ledger says no", async () => {
    const { src, calls } = source(() => ok({}), false);
    await expect(src.fetchPage("c")).rejects.toEqual(new ChatSourceError("quota"));
    expect(calls).toEqual([]);
  });

  it.each([
    [fail(403, "liveChatEnded"), "ended"],
    [fail(403, "liveChatDisabled"), "ended"],
    [fail(404), "ended"],
    [fail(403, "quotaExceeded"), "quota"],
    [fail(403, "rateLimitExceeded"), "rate_limited"],
    [fail(401), "unauthorized"],
    [fail(500), "unavailable"],
    [ok({ offlineAt: "2026-11-08T14:00:00Z" }), "ended"],
  ])("maps responses to error kinds (%#)", async (res, kind) => {
    await expect(source(() => res).src.fetchPage("c")).rejects.toEqual(new ChatSourceError(kind as never));
  });

  it("lets access-token errors through unchanged so callers can ask for reconnection", async () => {
    class TokenGone extends Error {}
    const src = new YoutubeChatSource({ fetch: async () => ok({}), accessToken: async () => Promise.reject(new TokenGone()), reserveQuota: async () => true });
    await expect(src.fetchPage("c")).rejects.toBeInstanceOf(TokenGone);
  });

  it("reports network failures as unavailable", async () => {
    const src = new YoutubeChatSource({ fetch: async () => Promise.reject(new Error("down")), accessToken: async () => "t", reserveQuota: async () => true });
    await expect(src.fetchPage("c")).rejects.toEqual(new ChatSourceError("unavailable"));
  });
});
