import type { PollInput } from "@et/core";
import { QuotaBudget, type QuotaSnapshot } from "@et/youtube";
import { DurableObject } from "cloudflare:workers";
import { defaultDeps, type AppEnv } from "../env";
import { SessionEngine, type StartInput, type StopReason } from "./engine";
import type { OverlayWidget, SessionStatus } from "../api-types";
import { googleCredentials, quotaClient } from "./clients";
import { overlayView } from "./overlay-view";
import { quotaLimits } from "./limits";
import { LiveSourceProvider } from "./sources";

const systemClock = { now: () => new Date() };
const WIDGETS: readonly OverlayWidget[] = ["poll"];
const MAX_SOCKETS_PER_WIDGET = 20;
const isWidget = (value: string | null): value is OverlayWidget => WIDGETS.includes(value as OverlayWidget);

export class LiveSession extends DurableObject<AppEnv> {
  private readonly engine: SessionEngine;

  constructor(ctx: DurableObjectState, env: AppEnv) {
    super(ctx, env);
    const provider = new LiveSourceProvider({
      fetch: defaultDeps.fetch,
      clock: systemClock,
      quota: quotaClient(env),
      credentials: () => googleCredentials(env),
    });
    const storage = {
      get: <T>(key: string) => ctx.storage.get<T>(key),
      put: (key: string, value: unknown) => ctx.storage.put(key, value),
      delete: (key: string) => ctx.storage.delete(key),
      setAlarm: (time: number) => ctx.storage.setAlarm(time),
      deleteAlarm: () => ctx.storage.deleteAlarm(),
      deleteAll: () => ctx.storage.deleteAll(),
    };
    this.engine = new SessionEngine(storage, provider, systemClock, {
      disabled: () => String(env.SESSIONS_DISABLED) === "true",
      onChange: (status) => this.broadcast(status),
    });
  }

  // Only reached through the Worker after it resolved an overlay token to this workspace; the client never names a DO.
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const widget = url.searchParams.get("widget");
    if (url.pathname !== "/overlay" || request.headers.get("Upgrade") !== "websocket" || !isWidget(widget)) {
      return new Response(null, { status: 400 });
    }
    if (this.ctx.getWebSockets(widget).length >= MAX_SOCKETS_PER_WIDGET) return new Response(null, { status: 429 });
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server, [widget]);
    const view = overlayView(widget, await this.engine.status());
    if (view) server.send(JSON.stringify(view));
    return new Response(null, { status: 101, webSocket: client });
  }

  private broadcast(status: SessionStatus): void {
    for (const widget of WIDGETS) {
      const view = overlayView(widget, status);
      if (!view) continue;
      const message = JSON.stringify(view);
      for (const socket of this.ctx.getWebSockets(widget)) {
        try {
          socket.send(message);
        } catch {
          socket.close(1011, "send failed");
        }
      }
    }
  }

  closeOverlays(widget: OverlayWidget) {
    for (const socket of this.ctx.getWebSockets(widget)) socket.close(4001, "rotated");
  }

  override webSocketMessage() {
    // Overlays are read-only; anything a client sends is ignored.
  }

  override webSocketClose(socket: WebSocket, code: number) {
    socket.close(code === 1005 ? 1000 : code, "closed");
  }

  start(input: StartInput) {
    return this.engine.start(input);
  }
  stop(reason?: StopReason) {
    return this.engine.stop(reason);
  }
  status() {
    return this.engine.status();
  }
  createPoll(input: PollInput) {
    return this.engine.createPoll(input);
  }
  closePoll() {
    return this.engine.closePoll();
  }
  purge() {
    return this.engine.purge();
  }
  override async alarm() {
    await this.engine.tick();
  }
}

export class QuotaKeeper extends DurableObject<AppEnv> {
  private budget: QuotaBudget | null = null;

  private async load(): Promise<QuotaBudget> {
    this.budget ??= new QuotaBudget(quotaLimits(this.env), await this.ctx.storage.get<QuotaSnapshot>("quota"));
    return this.budget;
  }

  async reserve(workspaceId: string, units: number) {
    const budget = await this.load();
    const decision = budget.reserve(workspaceId, units, new Date());
    if (decision.ok) await this.ctx.storage.put("quota", budget.snapshot());
    return decision;
  }

  async reserveDemo(workspaceId: string) {
    const budget = await this.load();
    const ok = budget.reserveDemo(workspaceId, new Date());
    if (ok) await this.ctx.storage.put("quota", budget.snapshot());
    return ok;
  }

  async usage(workspaceId: string) {
    return (await this.load()).usage(workspaceId, new Date());
  }
}
