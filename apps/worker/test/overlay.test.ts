import { describe, expect, it } from "vitest";
import type { MeResponse, OverlayRotateResponse } from "../src/api-types";
import { overlayView } from "../src/live/overlay-view";
import { clearOverlayMissCache, OVERLAY_PAGE_HEADERS } from "../src/overlay";
import { makeHarness, ORIGIN, type Harness } from "./harness";

async function owner(h: Harness) {
  const b = h.browser();
  await b.signIn();
  const ws = ((await (await b.request("/api/me")).json()) as MeResponse).workspaces[0]!.id;
  return { b, ws };
}

async function link(h: Harness) {
  const { b, ws } = await owner(h);
  const res = await b.post(`/api/workspaces/${ws}/overlays/poll/rotate`);
  const body = (await res.json()) as OverlayRotateResponse;
  return { b, ws, url: body.url, path: new URL(body.url).pathname };
}

describe("overlay links", () => {
  it("the owner creates a link once; only its hash is stored", async () => {
    const h = await makeHarness();
    const { url, path } = await link(h);
    expect(url).toMatch(new RegExp(`^${ORIGIN}/o/[A-Za-z0-9_-]{43}/poll$`));
    const token = path.split("/")[2]!;
    const { rows } = await h.db.transaction((tx) => tx.query<{ hex: string }>("SELECT encode(token_hash, 'hex') AS hex FROM app.overlay_token"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.hex).not.toContain(Buffer.from(token).toString("hex"));
  });

  it("serves the overlay page with its own strict headers for a valid link only", async () => {
    const h = await makeHarness();
    const { path } = await link(h);
    const page = await h.browser().request(path);
    expect(page.status).toBe(200);
    for (const [name, value] of Object.entries(OVERLAY_PAGE_HEADERS)) expect(page.headers.get(name), name).toBe(value);
    expect(await page.text()).toContain("<title>Overlay</title>");

    const token = path.split("/")[2]!;
    for (const bad of [`/o/${"B".repeat(43)}/poll`, `/o/${token}/leaderboard`, `/o/${token}/admin`, "/o/short/poll", `/o/${token}`]) {
      expect((await h.browser().request(bad)).status, bad).toBe(404);
    }
  });

  it("rotating kills the old link and closes its live connections", async () => {
    const h = await makeHarness();
    const { b, ws, path: oldPath } = await link(h);
    const rotated = (await (await b.post(`/api/workspaces/${ws}/overlays/poll/rotate`)).json()) as OverlayRotateResponse;
    expect((await h.browser().request(oldPath)).status).toBe(404);
    expect((await h.browser().request(new URL(rotated.url).pathname)).status).toBe(200);
    expect(h.closedOverlays).toEqual([
      [ws, "poll"],
      [ws, "poll"],
    ]);
  });

  it("forwards WebSocket upgrades for valid links to the right workspace only", async () => {
    const h = await makeHarness();
    const { ws, path } = await link(h);
    expect((await h.browser().request(`${path}/ws`)).status).toBe(426);
    expect((await h.browser().request(`${path}/ws`, { headers: { Upgrade: "websocket" } })).status).toBe(302);
    expect(h.sockets).toMatchObject([{ workspaceId: ws, widget: "poll", config: { theme: { preset: "night" } } }]);
    expect((await h.browser().request(`/o/${"C".repeat(43)}/poll/ws`, { headers: { Upgrade: "websocket" } })).status).toBe(404);
    expect(h.sockets).toHaveLength(1);
  });

  it("moderators see the link status but can't rotate; outsiders get 404", async () => {
    const h = await makeHarness();
    const { ws } = await link(h);
    h.google.account = { sub: "g-mod", email: "mod@example.test", scopes: ["openid", "email", "profile"] };
    const mod = h.browser();
    await mod.signIn("moderator");
    await h.db.transaction((tx) =>
      tx.query("INSERT INTO app.workspace_member (workspace_id, member_id, role) SELECT $1, id, 'moderator' FROM app.member WHERE google_sub = 'g-mod'", [ws]),
    );
    const list = (await (await mod.request(`/api/workspaces/${ws}/overlays`)).json()) as { overlays: { widget: string; rotatedAt: string | null }[] };
    expect(list.overlays).toEqual([
      { widget: "poll", rotatedAt: expect.any(String) },
      { widget: "leaderboard", rotatedAt: null },
    ]);
    expect(JSON.stringify(list)).not.toMatch(/\/o\//);
    expect((await mod.post(`/api/workspaces/${ws}/overlays/poll/rotate`)).status).toBe(403);

    h.google.account = { sub: "g-x", email: "x@example.test", channel: { id: "UCSYNTHxXXXXXXXXXXXXXXXX", title: "X" } };
    const outsider = h.browser();
    await outsider.signIn();
    expect((await outsider.post(`/api/workspaces/${ws}/overlays/poll/rotate`)).status).toBe(404);
    expect((await outsider.request(`/api/workspaces/${ws}/overlays`)).status).toBe(404);
  });

  it("remembers unknown links briefly so stale OBS sources don't hit the database", async () => {
    clearOverlayMissCache();
    const h = await makeHarness();
    let lookups = 0;
    const original = h.db.transaction.bind(h.db);
    h.db.transaction = (fn) => {
      lookups++;
      return original(fn);
    };
    const stale = `/o/${"D".repeat(43)}/poll`;
    for (let i = 0; i < 5; i++) expect((await h.browser().request(stale)).status).toBe(404);
    expect(lookups).toBe(1);
    h.clock.now = new Date(h.clock.now.getTime() + 6 * 60_000);
    await h.browser().request(stale);
    expect(lookups).toBe(2);
  });

  it("still serves a freshly created link right after a miss on a different token", async () => {
    clearOverlayMissCache();
    const h = await makeHarness();
    await h.browser().request(`/o/${"E".repeat(43)}/poll`);
    const { path } = await link(h);
    expect((await h.browser().request(path)).status).toBe(200);
  });

  it("rejects widgets that aren't built yet and cross-origin rotation", async () => {
    const h = await makeHarness();
    const { b, ws } = await owner(h);
    expect((await b.post(`/api/workspaces/${ws}/overlays/game/rotate`)).status).toBe(400);
    expect((await b.request(`/api/workspaces/${ws}/overlays/poll/rotate`, { method: "POST" })).status).toBe(403);
  });
});

describe("overlayView", () => {
  it("sends only what is drawn", () => {
    const view = overlayView("poll", {
      status: "live",
      mode: "demo",
      messagesSeen: 10,
      poll: { question: "Q", options: ["a", "b"], status: "open", voteChange: "first", counts: [2, 1], total: 3 },
    });
    expect(view).toEqual({ type: "poll", live: true, poll: { question: "Q", options: ["a", "b"], counts: [2, 1], total: 3, status: "open" } });
    expect(overlayView("game", { status: "idle", messagesSeen: 0, poll: null })).toBeNull();
    expect(
      overlayView("leaderboard", { status: "live", messagesSeen: 1, poll: null, season: "Mùa 1", leaderboard: [{ rank: 1, name: "A", points: 10 }] }),
    ).toEqual({ type: "leaderboard", live: true, title: "Mùa 1", entries: [{ rank: 1, name: "A", points: 10 }] });
  });
});

describe("widget config", () => {
  const json = (body: unknown) => ({ method: "PUT", body: JSON.stringify(body), headers: { "Content-Type": "application/json", Origin: ORIGIN } });

  it("the owner saves a sanitised theme, it's pushed live and travels with the overlay socket", async () => {
    const h = await makeHarness();
    const { b, ws, path } = await link(h);
    const saved = await b.request(`/api/workspaces/${ws}/widgets/poll/config`, json({ theme: { preset: "neon", accent: "teal", fontScale: 141, position: "url(x)" }, evil: "<script>" }));
    expect(await saved.json()).toEqual({ theme: expect.objectContaining({ preset: "neon", accent: "teal", fontScale: 140, position: "top-left" }) });
    expect(h.configPushes).toMatchObject([[ws, "poll", { theme: { preset: "neon" } }]]);
    expect(JSON.stringify(await (await b.request(`/api/workspaces/${ws}/widgets/poll/config`)).json())).not.toContain("script");
    await h.browser().request(`${path}/ws`, { headers: { Upgrade: "websocket" } });
    expect(h.sockets.at(-1)).toMatchObject({ config: { theme: { preset: "neon", accent: "teal" } } });
  });

  it("moderators read but can't save; outsiders see nothing; unknown widgets are rejected", async () => {
    const h = await makeHarness();
    const { b, ws } = await owner(h);
    expect((await b.request(`/api/workspaces/${ws}/widgets/chat/config`)).status).toBe(400);
    h.google.account = { sub: "g-mod", email: "mod@example.test", scopes: ["openid", "email", "profile"] };
    const mod = h.browser();
    await mod.signIn("moderator");
    await h.db.transaction((tx) =>
      tx.query("INSERT INTO app.workspace_member (workspace_id, member_id, role) SELECT $1, id, 'moderator' FROM app.member WHERE google_sub = 'g-mod'", [ws]),
    );
    expect((await mod.request(`/api/workspaces/${ws}/widgets/poll/config`)).status).toBe(200);
    expect((await mod.request(`/api/workspaces/${ws}/widgets/poll/config`, json({ theme: { preset: "day" } }))).status).toBe(403);
    h.google.account = { sub: "g-x", email: "x@example.test", channel: { id: "UCSYNTHxXXXXXXXXXXXXXXXX", title: "X" } };
    const outsider = h.browser();
    await outsider.signIn();
    expect((await outsider.request(`/api/workspaces/${ws}/widgets/poll/config`)).status).toBe(404);
  });
});
