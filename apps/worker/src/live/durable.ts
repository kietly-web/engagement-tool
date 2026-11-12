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
import { CONTENT_WIDGETS, showsNamesFor, withNamesFlag, type ContentWidget } from "./socket-flags";
import { quotaLimits } from "./limits";
import { LiveSourceProvider } from "./sources";

const systemClock = { now: () => new Date() };


function parseJson(text: string | null): unknown {
  try {
    return JSON.parse(text ?? "{}");
  } catch {
    return {};
  }
}
const SOCKET_TAGS: readonly OverlayWidget[] = [...CONTENT_WIDGETS, "scene"];
const MAX_SOCKETS_PER_WIDGET = 20;
const isSocketTag = (value: string | null): value is OverlayWidget => SOCKET_TAGS.includes(value as OverlayWidget);

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
    if (url.pathname !== "/overlay" || request.headers.get("Upgrade") !== "websocket" || !isSocketTag(widget)) {
      return new Response(null, { status: 400 });
    }
    if (this.ctx.getWebSockets(widget).length >= MAX_SOCKETS_PER_WIDGET) return new Response(null, { status: 429 });
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    const saved = parseJson(request.headers.get(OVERLAY_CONFIG_HEADER)) as Record<string, unknown>;
    const contents: ContentWidget[] = widget === "scene" ? [...CONTENT_WIDGETS] : CONTENT_WIDGETS.filter((w) => w === widget);
    const configs = contents.map((content) => ({ content, config: parseWidgetConfig(widget === "scene" ? saved[content] : saved, content) }));
    // Flags are attached before the socket can receive anything, so a broadcast during the await below can't leak names.
    server.serializeAttachment(configs.reduce<unknown>((a, { content, config }) => withNamesFlag(a, content, config.theme.showNames), { names: {} }));
    this.ctx.acceptWebSocket(server, [widget]);
    const status = await this.engine.status();
    for (const { content } of configs) {
      const config = parseWidgetConfig(widget === "scene" ? saved[content] : saved, content);
      server.send(JSON.stringify({ type: "config", widget: content, config }));
      const view = forSocket(overlayView(content, status), showsNamesFor(server.deserializeAttachment(), content));
      if (view) server.send(JSON.stringify(view));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  private socketsFor(content: ContentWidget): WebSocket[] {
    return [...this.ctx.getWebSockets(content), ...this.ctx.getWebSockets("scene")];
  }

  private send(content: ContentWidget, message: Parameters<typeof forSocket>[0]): void {
    if (!message) return;
    const withNames = JSON.stringify(message);
    const withoutNames = JSON.stringify(forSocket(message, false));
    for (const socket of this.socketsFor(content)) {
      try {
        socket.send(showsNamesFor(socket.deserializeAttachment(), content) ? withNames : withoutNames);
      } catch {
        socket.close(1011, "send failed");
      }
    }
  }

  private broadcast(status: SessionStatus): void {
    for (const content of ["poll", "leaderboard"] as const) this.send(content, overlayView(content, status));
  }

  private sendAlert(event: AlertEvent): void {
    this.send("alerts", { type: "alert", alert: event });
  }

  flushNow() {
    return this.engine.flushNow();
  }
  testAlert() {
    return this.engine.testAlert();
  }

  async configChanged(widget: OverlayWidget, config: object) {
    if (widget !== "poll" && widget !== "leaderboard" && widget !== "alerts") return;
    const parsed = parseWidgetConfig(config, widget);
    if (widget === "alerts") await this.engine.setAlertsConfig(parsed.alerts);
    const message = JSON.stringify({ type: "config", widget, config: parsed });
    for (const socket of this.socketsFor(widget)) {
      try {
        socket.serializeAttachment(withNamesFlag(socket.deserializeAttachment(), widget, parsed.theme.showNames));
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
  async status() {
    return { ...(await this.engine.status()), overlayConnections: this.ctx.getWebSockets("scene").length };
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
