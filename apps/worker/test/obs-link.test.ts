import { describe, expect, it } from "vitest";
import type { MeResponse, ObsLinkResponse } from "../src/api-types";
import { makeHarness, ORIGIN, type Harness } from "./harness";

async function owner(h: Harness) {
  const b = h.browser();
  await b.signIn();
  const ws = ((await (await b.request("/api/me")).json()) as MeResponse).workspaces[0]!.id;
  return { b, ws };
}

const upgrade = { headers: { Upgrade: "websocket" } };

describe("one-step OBS link", () => {
  it("is created on first view, shown again unchanged, and stored only as a hash plus ciphertext", async () => {
    const h = await makeHarness();
    const { b, ws } = await owner(h);
    const first = (await (await b.request(`/api/workspaces/${ws}/obs-link`)).json()) as ObsLinkResponse;
    expect(first.url).toMatch(new RegExp(`^${ORIGIN}/o/[A-Za-z0-9_-]{43}/scene$`));
    expect(first.dragUrl).toBe(`${first.url}?layer-name=Engagement%20Tool&layer-width=1920&layer-height=1080`);
    const again = (await (await b.request(`/api/workspaces/${ws}/obs-link`)).json()) as ObsLinkResponse;
    expect(again.url).toBe(first.url);

    const token = new URL(first.url).pathname.split("/")[2]!;
    const tokenHex = Buffer.from(token).toString("hex");
    const { rows } = await h.db.transaction((tx) =>
      tx.query<{ hash: string; enc: string }>("SELECT encode(token_hash, 'hex') AS hash, encode(token_enc, 'hex') AS enc FROM app.overlay_token WHERE widget = 'scene'"),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.hash).not.toContain(tokenHex);
    expect(rows[0]!.enc).not.toContain(tokenHex);
  });

  it("serves the page with the drag parameters and opens one socket carrying every widget's config", async () => {
    const h = await makeHarness();
    const { b, ws } = await owner(h);
    await b.request(`/api/workspaces/${ws}/widgets/leaderboard/config`, {
      method: "PUT",
      body: JSON.stringify({ theme: { preset: "neon", showNames: false } }),
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
    });
    const { url, dragUrl } = (await (await b.request(`/api/workspaces/${ws}/obs-link`)).json()) as ObsLinkResponse;
    const path = new URL(url).pathname;
    expect((await h.browser().request(new URL(dragUrl).pathname + new URL(dragUrl).search)).status).toBe(200);
    expect((await h.browser().request(`${path}/ws`, upgrade)).status).toBe(302);
    expect(h.sockets).toMatchObject([
      {
        workspaceId: ws,
        widget: "scene",
        config: {
          poll: { theme: { preset: "night" } },
          leaderboard: { theme: { preset: "neon", showNames: false } },
          alerts: { theme: { preset: "night" }, alerts: expect.any(Object) },
        },
      },
    ]);
  });

  it("rotating kills the old link and closes its live connections", async () => {
    const h = await makeHarness();
    const { b, ws } = await owner(h);
    const old = (await (await b.request(`/api/workspaces/${ws}/obs-link`)).json()) as ObsLinkResponse;
    const fresh = (await (await b.post(`/api/workspaces/${ws}/obs-link/rotate`)).json()) as ObsLinkResponse;
    expect(fresh.url).not.toBe(old.url);
    expect((await h.browser().request(new URL(old.url).pathname)).status).toBe(404);
    expect((await h.browser().request(new URL(fresh.url).pathname)).status).toBe(200);
    expect(h.closedOverlays).toEqual([[ws, "scene"]]);
    expect(((await (await b.request(`/api/workspaces/${ws}/obs-link`)).json()) as ObsLinkResponse).url).toBe(fresh.url);
  });

  it("replaces a link it can't decrypt, closes the old sockets and records it", async () => {
    const h = await makeHarness();
    const { b, ws } = await owner(h);
    const old = (await (await b.request(`/api/workspaces/${ws}/obs-link`)).json()) as ObsLinkResponse;
    await h.db.transaction((tx) => tx.query("UPDATE app.overlay_token SET token_enc = decode(repeat('01', 40), 'hex') WHERE widget = 'scene'"));
    const fresh = (await (await b.request(`/api/workspaces/${ws}/obs-link`)).json()) as ObsLinkResponse;
    expect(fresh.url).not.toBe(old.url);
    expect((await h.browser().request(new URL(old.url).pathname)).status).toBe(404);
    expect(h.closedOverlays).toEqual([[ws, "scene"]]);
    const { rows } = await h.db.transaction((tx) => tx.query<{ detail: unknown }>("SELECT detail FROM app.audit_event WHERE action = 'overlay_rotated'"));
    expect(rows.map((r) => r.detail)).toEqual([{ widget: "scene", reason: "undecryptable" }]);
  });

  it("only the owner sees or rotates it; cross-origin rotation is refused", async () => {
    const h = await makeHarness();
    const { b, ws } = await owner(h);
    await b.request(`/api/workspaces/${ws}/obs-link`);
    expect((await b.request(`/api/workspaces/${ws}/obs-link/rotate`, { method: "POST" })).status).toBe(403);

    h.google.account = { sub: "g-mod", email: "mod@example.test", scopes: ["openid", "email", "profile"] };
    const mod = h.browser();
    await mod.signIn("moderator");
    await h.db.transaction((tx) =>
      tx.query("INSERT INTO app.workspace_member (workspace_id, member_id, role) SELECT $1, id, 'moderator' FROM app.member WHERE google_sub = 'g-mod'", [ws]),
    );
    expect((await mod.request(`/api/workspaces/${ws}/obs-link`)).status).toBe(403);
    expect((await mod.post(`/api/workspaces/${ws}/obs-link/rotate`)).status).toBe(403);

    h.google.account = { sub: "g-x", email: "x@example.test", channel: { id: "UCSYNTHxXXXXXXXXXXXXXXXX", title: "X" } };
    const outsider = h.browser();
    await outsider.signIn();
    expect((await outsider.request(`/api/workspaces/${ws}/obs-link`)).status).toBe(404);
    expect((await outsider.post(`/api/workspaces/${ws}/obs-link/rotate`)).status).toBe(404);
  });

  it("a per-widget link can't be opened as a scene, and the scene can't be rotated through the per-widget route", async () => {
    const h = await makeHarness();
    const { b, ws } = await owner(h);
    const poll = (await (await b.post(`/api/workspaces/${ws}/overlays/poll/rotate`)).json()) as { url: string };
    const token = new URL(poll.url).pathname.split("/")[2]!;
    expect((await h.browser().request(`/o/${token}/scene`)).status).toBe(404);
    expect((await b.post(`/api/workspaces/${ws}/overlays/scene/rotate`)).status).toBe(400);
  });
});

describe("scene socket name flags", async () => {
  const { showsNamesFor, withNamesFlag } = await import("../src/live/socket-flags");
  it("keeps one show-names choice per widget on a scene socket", () => {
    let a: unknown = null;
    expect(showsNamesFor(a, "leaderboard")).toBe(false);
    expect(showsNamesFor({ names: {} }, "alerts")).toBe(false);
    a = withNamesFlag(a, "leaderboard", false);
    a = withNamesFlag(a, "alerts", true);
    expect(showsNamesFor(a, "leaderboard")).toBe(false);
    expect(showsNamesFor(a, "alerts")).toBe(true);
    expect(showsNamesFor(withNamesFlag(a, "leaderboard", true), "leaderboard")).toBe(true);
  });
});
