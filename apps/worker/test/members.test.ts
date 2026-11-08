import { describe, expect, it } from "vitest";
import type { MeResponse, WorkspaceResponse } from "../src/api-types";
import { makeHarness, ORIGIN, type Browser, type Harness } from "./harness";

const json = (body: unknown) => ({ body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

async function owner(h: Harness) {
  const b = h.browser();
  await b.signIn();
  const ws = ((await (await b.request("/api/me")).json()) as MeResponse).workspaces[0]!.id;
  return { b, ws };
}

async function moderator(h: Harness, email: string, sub = `g-${email}`): Promise<Browser> {
  h.google.account = { sub, email, scopes: ["openid", "email", "profile"] };
  const m = h.browser();
  await m.signIn("moderator");
  return m;
}

async function invite(b: Browser, ws: string, email: string) {
  const res = await b.post(`/api/workspaces/${ws}/invites`, json({ email }));
  return { res, token: (((await res.json()) as { url?: string }).url ?? "").split("/invite/")[1] ?? "" };
}

describe("invites", () => {
  it("an owner invites by email; only that verified address can accept, once", async () => {
    const h = await makeHarness();
    const { b, ws } = await owner(h);
    const { res, token } = await invite(b, ws, "Mod@Example.test");
    expect(res.status).toBe(201);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const wrong = await moderator(h, "other@example.test");
    expect((await wrong.post("/api/invites/accept", json({ token }))).status).toBe(403);

    const mod = await moderator(h, "mod@example.test");
    const accepted = await mod.post("/api/invites/accept", json({ token }));
    expect(await accepted.json()).toEqual({ workspaceId: ws, outcome: "accepted" });
    const view = (await (await mod.request(`/api/workspaces/${ws}`)).json()) as WorkspaceResponse;
    expect(view.workspace.role).toBe("moderator");
    expect((await mod.post("/api/invites/accept", json({ token }))).status).toBe(404);
  });

  it("validates input and keeps invites owner-only", async () => {
    const h = await makeHarness();
    const { b, ws } = await owner(h);
    expect((await b.post(`/api/workspaces/${ws}/invites`, json({ email: "not-an-email" }))).status).toBe(400);
    expect((await b.post(`/api/workspaces/${ws}/invites`, json({ email: "<a@b.c>" }))).status).toBe(400);
    const { token } = await invite(b, ws, "mod@example.test");
    const mod = await moderator(h, "mod@example.test");
    await mod.post("/api/invites/accept", json({ token }));
    expect((await mod.post(`/api/workspaces/${ws}/invites`, json({ email: "x@example.test" }))).status).toBe(403);
    expect((await mod.request(`/api/workspaces/${ws}/invites`)).status).toBe(403);
    expect((await mod.request(`/api/workspaces/${ws}/audit`)).status).toBe(403);
    expect((await mod.post("/api/invites/accept", json({ token: "short" }))).status).toBe(404);
  });

  it("an owner sees and revokes pending invites; a revoked link stops working", async () => {
    const h = await makeHarness();
    const { b, ws } = await owner(h);
    const { token } = await invite(b, ws, "late@example.test");
    const list = (await (await b.request(`/api/workspaces/${ws}/invites`)).json()) as { invites: { id: string; email: string }[] };
    expect(list.invites.map((i) => i.email)).toEqual(["late@example.test"]);
    expect(JSON.stringify(list)).not.toContain(token);
    expect((await b.request(`/api/workspaces/${ws}/invites/${list.invites[0]!.id}`, { method: "DELETE", headers: { Origin: ORIGIN } })).status).toBe(204);
    const late = await moderator(h, "late@example.test");
    expect((await late.post("/api/invites/accept", json({ token }))).status).toBe(404);
  });
});

describe("members and audit", () => {
  it("a moderator can leave, an owner can remove one, and the owner can't leave; all of it is logged", async () => {
    const h = await makeHarness();
    const { b, ws } = await owner(h);
    const me = (await (await b.request("/api/me")).json()) as MeResponse;
    const ids: Record<string, string> = {};
    for (const email of ["one@example.test", "two@example.test"]) {
      const { token } = await invite(b, ws, email);
      const m = await moderator(h, email);
      await m.post("/api/invites/accept", json({ token }));
      ids[email] = ((await (await m.request("/api/me")).json()) as MeResponse).member.id;
      if (email === "one@example.test") {
        expect((await m.request(`/api/workspaces/${ws}/members/${me.member.id}`, { method: "DELETE", headers: { Origin: ORIGIN } })).status).toBe(403);
        expect((await m.request(`/api/workspaces/${ws}/members/${ids[email]}`, { method: "DELETE", headers: { Origin: ORIGIN } })).status).toBe(204);
      }
    }
    expect((await b.request(`/api/workspaces/${ws}/members/${ids["two@example.test"]}`, { method: "DELETE", headers: { Origin: ORIGIN } })).status).toBe(204);
    expect((await b.request(`/api/workspaces/${ws}/members/${me.member.id}`, { method: "DELETE", headers: { Origin: ORIGIN } })).status).toBe(400);

    await b.post(`/api/workspaces/${ws}/overlays/poll/rotate`);
    const events = (await (await b.request(`/api/workspaces/${ws}/audit`)).json()) as { events: { action: string; detail: object }[] };
    expect(events.events.map((e) => e.action)).toEqual(
      expect.arrayContaining(["invite_created", "invite_accepted", "member_left", "member_removed", "overlay_rotated"]),
    );
    expect(JSON.stringify(events)).not.toMatch(/UC[A-Za-z0-9_-]{22}|token|@example/);
  });
});
