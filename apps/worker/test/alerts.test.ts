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
