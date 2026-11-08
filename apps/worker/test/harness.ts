import type { Database } from "@et/db";
import { loadMigrations } from "@et/db/migrations";
import { createTestDatabase } from "@et/db/testing";
import { QuotaBudget, type FetchLike } from "@et/youtube";
import { createApp } from "../src/app";
import { googleCredentials, type QuotaUsageClient } from "../src/live/clients";
import { SessionEngine } from "../src/live/engine";
import { LiveSourceProvider } from "../src/live/sources";
import { MemoryStorage } from "./memory-storage";
import { toBase64Url } from "../src/crypto";
import type { AppEnv } from "../src/env";
import { GOOGLE } from "../src/google";

export const ORIGIN = "http://localhost";
const key = (fill: number) => btoa(String.fromCharCode(...new Uint8Array(32).fill(fill)));

export interface GoogleAccount {
  sub: string;
  email: string;
  emailVerified?: boolean;
  scopes?: string[];
  refreshToken?: string | null;
  channel?: { id: string; title: string } | null;
  channelStatus?: number;
  nonceOverride?: string;
}

export class FakeGoogle {
  account: GoogleAccount = { sub: "g-1", email: "creator@example.test" };
  nonce = "";
  revoked: string[] = [];
  revokeStatus = 200;
  calls: string[] = [];
  live: { broadcastId: string; liveChatId: string } | null = null;
  refreshInvalid = false;
  chatPages: unknown[] = [];

  fetch: FetchLike = async (url, init) => {
    this.calls.push(url.split("?")[0]!);
    const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
    const a = this.account;
    if (url === GOOGLE.tokenUrl && new URLSearchParams(init?.body).get("grant_type") === "refresh_token") {
      return this.refreshInvalid ? json(400, { error: "invalid_grant" }) : json(200, { access_token: "live-at", expires_in: 3600 });
    }
    if (url.startsWith("https://www.googleapis.com/youtube/v3/liveBroadcasts")) {
      return json(200, { items: this.live ? [{ id: this.live.broadcastId, snippet: { liveChatId: this.live.liveChatId } }] : [] });
    }
    if (url.startsWith("https://www.googleapis.com/youtube/v3/liveChat/messages")) {
      return json(200, this.chatPages.shift() ?? { items: [], nextPageToken: "same", pollingIntervalMillis: 5000 });
    }
    if (url === GOOGLE.tokenUrl) {
      const enc = (o: unknown) => toBase64Url(new TextEncoder().encode(JSON.stringify(o)));
      const claims = {
        iss: "https://accounts.google.com",
        aud: "client-1",
        exp: 1_900_000_000,
        nonce: a.nonceOverride ?? this.nonce,
        sub: a.sub,
        email: a.email,
        email_verified: a.emailVerified ?? true,
        name: a.email.split("@")[0],
      };
      return json(200, {
        access_token: `at-${a.sub}`,
        refresh_token: a.refreshToken === undefined ? `rt-${a.sub}` : a.refreshToken ?? undefined,
        id_token: `${enc({ alg: "RS256" })}.${enc(claims)}.sig`,
        scope: (a.scopes ?? ["openid", "email", "profile", GOOGLE.youtubeScope]).join(" "),
      });
    }
    if (url.startsWith("https://www.googleapis.com/youtube/v3/channels")) {
      if (a.channelStatus) return json(a.channelStatus, {});
      return json(200, { items: a.channel === null ? [] : [{ id: a.channel?.id ?? "UCSYNTHxAAAAAAAAAAAAAAAA", snippet: { title: a.channel?.title ?? "Kênh Thử" } }] });
    }
    if (url === GOOGLE.revokeUrl) {
      this.revoked.push(new URLSearchParams(init?.body).get("token") ?? "");
      return json(this.revokeStatus, {});
    }
    throw new Error(`unexpected fetch ${url}`);
  };
}

export class Browser {
  jar = new Map<string, string>();
  constructor(private h: Harness) {}

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.jar.size) headers.set("Cookie", [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "));
    const res = await this.h.app.request(`${ORIGIN}${path}`, { ...init, headers }, this.h.env);
    for (const raw of res.headers.getSetCookie()) {
      const [pair] = raw.split(";");
      const [name, ...rest] = pair!.split("=");
      const value = rest.join("=");
      if (!value || /max-age=0/i.test(raw)) this.jar.delete(name!);
      else this.jar.set(name!, value);
    }
    return res;
  }

  post(path: string, init: RequestInit = {}) {
    return this.request(path, { ...init, method: init.method ?? "POST", headers: { Origin: ORIGIN, ...(init.headers as Record<string, string>) } });
  }

  async signIn(intent: "creator" | "moderator" = "creator"): Promise<string> {
    const start = await this.request(`/api/auth/google/start?intent=${intent}`);
    const google = new URL(start.headers.get("Location")!);
    this.h.google.nonce = google.searchParams.get("nonce")!;
    const cb = await this.request(`/api/auth/google/callback?state=${google.searchParams.get("state")}&code=c`);
    return cb.headers.get("Location")!;
  }
}

export interface Harness {
  app: ReturnType<typeof createApp>;
  env: AppEnv;
  db: Database;
  google: FakeGoogle;
  clock: { now: Date };
  engines: Map<string, SessionEngine>;
  quota: QuotaBudget;
  browser(): Browser;
}

export async function makeHarness(opts: { configured?: boolean; quota?: { projectDaily: number; workspaceDaily: number } } = {}): Promise<Harness> {
  const db = await createTestDatabase(await loadMigrations());
  const google = new FakeGoogle();
  const clock = { now: new Date("2026-11-08T12:00:00Z") };
  const engines = new Map<string, SessionEngine>();
  const quota = new QuotaBudget(opts.quota ?? { projectDaily: 9000, workspaceDaily: 3000 });
  const quotaClient: QuotaUsageClient = {
    reserve: async (ws, units) => quota.reserve(ws, units, clock.now),
    usage: async (ws) => quota.usage(ws, clock.now),
  };
  const engineClock = { now: () => clock.now };
  const app = createApp({
    database: () => db,
    fetch: google.fetch,
    now: () => clock.now,
    quota: () => quotaClient,
    liveSession: (env, ws) => {
      let engine = engines.get(ws);
      if (!engine) {
        const provider = new LiveSourceProvider({ fetch: google.fetch, quota: quotaClient, clock: engineClock, credentials: () => googleCredentials(env) });
        engine = new SessionEngine(new MemoryStorage(), provider, engineClock);
        engines.set(ws, engine);
      }
      return engine;
    },
  });
  const env = {
    APP_ENV: "production",
    ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
    ...(opts.configured === false
      ? {}
      : { GOOGLE_CLIENT_ID: "client-1", GOOGLE_CLIENT_SECRET: "secret", SESSION_SECRET: key(1), TOKEN_ENCRYPTION_KEY: key(2) }),
  } as unknown as AppEnv;
  const h: Harness = { app, env, db, google, clock, engines, quota, browser: () => new Browser(h) };
  return h;
}
