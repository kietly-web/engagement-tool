import { syntheticChannelId } from "@et/core";
import { describe, expect, it } from "vitest";
import type { MeResponse } from "../src/api-types";
import { makeHarness, ORIGIN, type Harness } from "./harness";

const put = (body: unknown) => ({ method: "PUT", body: JSON.stringify(body), headers: { "Content-Type": "application/json", Origin: ORIGIN } });
const json = (body: unknown) => ({ body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const item = (v: number, text: string) => ({
  snippet: { type: "textMessageEvent", textMessageDetails: { messageText: text } },
  authorDetails: { channelId: syntheticChannelId(v), displayName: `Người xem ${v}` },
});

async function live(h: Harness) {
  const b = h.browser();
  await b.signIn();
  const ws = ((await (await b.request("/api/me")).json()) as MeResponse).workspaces[0]!.id;
  await b.request(`/api/workspaces/${ws}/widgets/alerts/config`, put({ alerts: { commands: [{ trigger: "tim", text: "Thả tim cho idol!", sticker: "heart", animation: "bounce" }], viewerCooldownSeconds: 30, globalCooldownSeconds: 1 } }));
  h.google.live = { broadcastId: "b1", liveChatId: "chat-1" };
  await b.post(`/api/workspaces/${ws}/session`, json({ mode: "youtube" }));
  return { b, ws };
}

describe("erased viewers", () => {
  it("can't fire alerts or put their name back on stream after erasure", async () => {
    const h = await makeHarness();
    const { b, ws } = await live(h);
    const erased = syntheticChannelId(9);
    expect((await b.request(`/api/workspaces/${ws}/viewers/${erased}`, { method: "DELETE", headers: { Origin: ORIGIN } })).status).toBe(200);
    h.google.chatPages.push({ items: [item(9, "!tim")], nextPageToken: "p", pollingIntervalMillis: 3000 });
    await h.engines.get(ws)!.tick();
    expect(h.alertsSent).toEqual([]);
  });
});

describe("custom command alerts", () => {
  it("fires the creator's alert with the viewer's session name, honours cooldowns, and never steals built-in commands", async () => {
    const h = await makeHarness();
    const { ws } = await live(h);
    h.google.chatPages.push({ items: [item(1, "!tìm"), item(1, "!tim nữa"), item(2, "!vote 1"), item(3, "tim")], nextPageToken: "p", pollingIntervalMillis: 3000 });
    await h.engines.get(ws)!.tick();
    expect(h.alertsSent).toEqual([[ws, { source: "command", title: "Thả tim cho idol!", name: "Người xem 1", sticker: "heart", animation: "bounce" }]]);
    h.clock.now = new Date(h.clock.now.getTime() + 2000);
    h.google.chatPages.push({ items: [item(1, "!tim"), item(2, "!TIM")], nextPageToken: "q", pollingIntervalMillis: 3000 });
    await h.engines.get(ws)!.tick();
    expect(h.alertsSent.map(([, e]) => (e as { name: string }).name)).toEqual(["Người xem 1", "Người xem 2"]);
  });

  it("saving alert commands keeps the theme, and saving the theme keeps the commands; changes reach a running session", async () => {
    const h = await makeHarness();
    const { b, ws } = await live(h);
    await b.request(`/api/workspaces/${ws}/widgets/alerts/config`, put({ theme: { preset: "day" } }));
    const after = (await (await b.request(`/api/workspaces/${ws}/widgets/alerts/config`)).json()) as { theme: { preset: string }; alerts: { commands: { trigger: string }[] } };
    expect(after.theme.preset).toBe("day");
    expect(after.alerts.commands.map((c) => c.trigger)).toEqual(["tim"]);

    await b.request(`/api/workspaces/${ws}/widgets/alerts/config`, put({ alerts: { commands: [{ trigger: "hi", text: "Xin chào", sticker: "wave" }] } }));
    h.google.chatPages.push({ items: [item(4, "!hi"), item(5, "!tim")], nextPageToken: "p", pollingIntervalMillis: 3000 });
    await h.engines.get(ws)!.tick();
    expect(h.alertsSent.map(([, e]) => (e as { title: string }).title)).toEqual(["Xin chào"]);
  });

  it("any member can send a test alert; outsiders can't", async () => {
    const h = await makeHarness();
    const { b, ws } = await live(h);
    expect((await b.post(`/api/workspaces/${ws}/session/alerts/test`)).status).toBe(204);
    expect(h.alertsSent.at(-1)?.[1]).toMatchObject({ source: "test" });
    expect((await b.post(`/api/workspaces/${ws}/session/alerts/test`)).status).toBe(429);
    h.google.account = { sub: "g-x", email: "x@example.test", channel: { id: "UCSYNTHxXXXXXXXXXXXXXXXX", title: "X" } };
    const other = h.browser();
    await other.signIn();
    expect((await other.post(`/api/workspaces/${ws}/session/alerts/test`)).status).toBe(404);
  });
});

describe("donation alerts", () => {
  it("shows Super Chats and memberships without letting their text vote or earn points", async () => {
    const h = await makeHarness();
    const { b, ws } = await live(h);
    await b.post(`/api/workspaces/${ws}/session/poll`, json({ question: "Q?", options: ["a", "b"] }));
    const donor = { channelId: syntheticChannelId(7), displayName: "Nhà tài trợ" };
    h.google.chatPages.push({
      items: [
        { snippet: { type: "superChatEvent", superChatDetails: { amountDisplayString: "₫50.000", userComment: "!vote 1" } }, authorDetails: donor },
        { snippet: { type: "newSponsorEvent" }, authorDetails: { ...donor, channelId: syntheticChannelId(8) } },
      ],
      nextPageToken: "p",
      pollingIntervalMillis: 3000,
    });
    await h.engines.get(ws)!.tick();
    expect(h.alertsSent.map(([, e]) => e)).toEqual([
      { source: "super_chat", title: "!vote 1", name: "Nhà tài trợ", sticker: "gift", animation: "bounce", amount: "₫50.000" },
      { source: "membership", title: "", name: "Nhà tài trợ", sticker: "star", animation: "bounce" },
    ]);
    const session = (await (await b.request(`/api/workspaces/${ws}/session`)).json()) as { session: { poll: { total: number }; leaderboard: unknown[] } };
    expect(session.session.poll.total).toBe(0);
    expect(session.session.leaderboard).toEqual([]);
  });

  it("respects the owner's switches", async () => {
    const h = await makeHarness();
    const { b, ws } = await live(h);
    await b.request(`/api/workspaces/${ws}/widgets/alerts/config`, put({ alerts: { donations: { superChats: false, memberships: true, showAmount: false, showComment: true } } }));
    h.google.chatPages.push({
      items: [
        { snippet: { type: "superChatEvent", superChatDetails: { amountDisplayString: "$5", userComment: "hi" } }, authorDetails: { channelId: syntheticChannelId(1), displayName: "A" } },
        { snippet: { type: "membershipGiftingEvent", membershipGiftingDetails: { giftMembershipsCount: 3 } }, authorDetails: { channelId: syntheticChannelId(2), displayName: "B" } },
      ],
      nextPageToken: "p",
      pollingIntervalMillis: 3000,
    });
    await h.engines.get(ws)!.tick();
    expect(h.alertsSent.map(([, e]) => e)).toEqual([{ source: "membership", title: "", name: "B", sticker: "gift", animation: "bounce" }]);
  });
});

describe("donation review regressions", () => {
  it("a donation can't fire a custom command or join, and an erased donor shows only a generic thank-you", async () => {
    const h = await makeHarness();
    const { b, ws } = await live(h);
    await b.request(`/api/workspaces/${ws}/widgets/alerts/config`, put({ alerts: { commands: [{ trigger: "hype", text: "HYPE!" }] } }));
    const erased = syntheticChannelId(6);
    await b.request(`/api/workspaces/${ws}/viewers/${erased}`, { method: "DELETE", headers: { Origin: ORIGIN } });
    const sc = (v: number, comment: string) => ({
      snippet: { type: "superChatEvent", superChatDetails: { amountDisplayString: "₫10.000", userComment: comment } },
      authorDetails: { channelId: syntheticChannelId(v), displayName: `Người ${v}` },
    });
    h.google.chatPages.push({ items: [sc(1, "!hype"), sc(2, "!join"), sc(6, "Linh lớp 6A đây!")], nextPageToken: "p", pollingIntervalMillis: 3000 });
    await h.engines.get(ws)!.tick();
    const events = h.alertsSent.map(([, e]) => e as { source: string; title: string; name: string | null; amount?: string });
    expect(events.every((e) => e.source === "super_chat")).toBe(true);
    expect(events.at(-1)).toEqual({ source: "super_chat", title: "", name: null, sticker: "gift", animation: "bounce" });
    const session = (await (await b.request(`/api/workspaces/${ws}/session`)).json()) as { session: { leaderboard: unknown[] } };
    expect(session.session.leaderboard).toEqual([]);
  });
});
