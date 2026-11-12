import type { PollInput } from "@et/core";
import { QuotaBudget, type QuotaSnapshot } from "@et/youtube";
import { DurableObject } from "cloudflare:workers";
import { defaultDeps, type AppEnv } from "../env";
import { SessionEngine, type StartInput, type StopReason } from "./engine";
import { parseWidgetConfig, type AlertEvent } from "@et/core";
import type { OverlayWidget, SessionStatus } from "../api-types";
import { createPgDatabase } from "@et/db";
import { googleCredentials, OVERLAY_CONFIG_HEADER, quotaClient } from "./clients";
import { DbPointsStore } from "./points-store";
import { forSocket, overlayView } from "./overlay-view";
import { quotaLimits } from "./limits";
import { LiveSourceProvider } from "./sources";

const systemClock = { now: () => new Date() };

function showsNames(socket: WebSocket): boolean {
  return (socket.deserializeAttachment() as { showNames?: boolean } | null)?.showNames !== false;
}

function parseJson(text: string | null): unknown {
  try {
    return JSON.parse(text ?? "{}");
  } catch {
    return {};
  }
}
const WIDGETS: readonly OverlayWidget[] = ["poll", "leaderboard", "alerts"];
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
      onAlert: (event) => this.sendAlert(event),
      points: (state) =>
        env.HYPERDRIVE && state.startedBy
          ? new DbPointsStore(createPgDatabase(env.HYPERDRIVE.connectionString), { memberId: state.startedBy, workspaceId: state.workspaceId })
          : null,
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
    const config = parseWidgetConfig(parseJson(request.headers.get(OVERLAY_CONFIG_HEADER)), widget);
    server.serializeAttachment({ showNames: config.theme.showNames });
    server.send(JSON.stringify({ type: "config", config }));
    const view = forSocket(overlayView(widget, await this.engine.status()), config.theme.showNames);
    if (view) server.send(JSON.stringify(view));
    return new Response(null, { status: 101, webSocket: client });
  }

  private broadcast(status: SessionStatus): void {
    for (const widget of WIDGETS) {
      const view = overlayView(widget, status);
      if (!view) continue;
      const withNames = JSON.stringify(view);
      const withoutNames = JSON.stringify(forSocket(view, false));
      for (const socket of this.ctx.getWebSockets(widget)) {
        try {
          socket.send(showsNames(socket) ? withNames : withoutNames);
        } catch {
          socket.close(1011, "send failed");
        }
      }
    }
  }

  private sendAlert(event: AlertEvent): void {
    const full = { type: "alert" as const, alert: event };
    const withNames = JSON.stringify(full);
    const withoutNames = JSON.stringify(forSocket(full, false));
    for (const socket of this.ctx.getWebSockets("alerts")) {
      try {
        socket.send(showsNames(socket) ? withNames : withoutNames);
      } catch {
        socket.close(1011, "send failed");
      }
    }
  }

  testAlert() {
    this.engine.testAlert();
  }

  async configChanged(widget: OverlayWidget, config: object) {
    const parsed = parseWidgetConfig(config, widget);
    if (widget === "alerts") await this.engine.setAlertsConfig(parsed.alerts);
    const message = JSON.stringify({ type: "config", config: parsed });
    for (const socket of this.ctx.getWebSockets(widget)) {
      try {
        socket.serializeAttachment({ showNames: parsed.theme.showNames });
        socket.send(message);
      } catch {
        socket.close(1011, "send failed");
      }
    }
  }

  closeOverlays(widget: OverlayWidget) {
    for (const socket of this.ctx.getWebSockets(widget)) socket.close(4001, "rotated");
  }

  // Overlays never send anything; closing on the first frame stops a leaked link from burning DO requests.
  override webSocketMessage(socket: WebSocket) {
    socket.close(1008, "read-only");
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
  eraseViewer(channelId: string) {
    return this.engine.eraseViewer(channelId);
  }
  stopIfStartedBy(memberId: string) {
    return this.engine.stopIfStartedBy(memberId);
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
