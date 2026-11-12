import type { AlertsConfigView, OverlayMessage, OverlayTheme } from "@et/worker/api-types";
import { backoffMs, leaderboardModel, parseMessage, parseOverlayPath, pollModel, shouldReconnect } from "./model";
import { applyTheme, decodePreview, DEFAULT_THEME, themeFrom } from "./theme";
import { AlertQueue, alertView, hintTriggers, SHOW_MS, type AlertView } from "./alerts";
import { t } from "./i18n";
import "./overlay.css";

type PanelWidget = "poll" | "leaderboard" | "alerts";
const PANEL_ORDER: readonly PanelWidget[] = ["poll", "leaderboard", "alerts"];
const SLOTS: readonly OverlayTheme["position"][] = ["top-left", "top-right", "bottom-left", "bottom-right", "center"];

const stage = document.getElementById("stage")!;
const slots = new Map(
  SLOTS.map((name) => {
    const slot = el("div", "slot");
    slot.dataset.slot = name;
    stage.append(slot);
    return [name, slot] as const;
  }),
);

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

class Panel {
  readonly root = el("div", "panel");
  private theme = DEFAULT_THEME;
  private lastContent: OverlayMessage | null = null;
  private hint: string[] = [];
  private readonly queue = new AlertQueue<AlertView>((a) => a.paid);
  private showing = false;

  constructor(readonly widget: PanelWidget) {
    applyTheme(this.root, this.theme);
  }

  get position(): OverlayTheme["position"] {
    return this.theme.position;
  }

  configure(config: { theme: OverlayTheme; alerts?: AlertsConfigView }): void {
    this.theme = themeFrom(config);
    applyTheme(this.root, this.theme);
    if (this.widget === "alerts") {
      this.hint = hintTriggers(config.alerts);
      if (!this.showing) this.renderHint();
    }
    if (this.lastContent) this.show(this.lastContent);
  }

  alert(message: Extract<OverlayMessage, { type: "alert" }>): void {
    const view = alertView(message, { test: t["alerts.testTitle"], superChat: t["alerts.superChat"], membership: t["alerts.membership"] });
    if (!view) return;
    this.queue.push(this.theme.showNames ? view : { ...view, name: null });
    if (!this.showing) this.playNext();
  }

  show(message: OverlayMessage): void {
    this.lastContent = message;
    if (message.type === "leaderboard") this.renderLeaderboard(message);
    else this.renderPoll(message);
  }

  clear(): void {
    this.root.replaceChildren();
  }

  private renderHint(): void {
    this.root.replaceChildren();
    if (this.hint.length > 0) this.root.append(el("div", "alert-hint", t["alerts.hint"](this.hint)));
  }

  private playNext(): void {
    const next = this.queue.next();
    if (!next) {
      this.showing = false;
      this.renderHint();
      return;
    }
    this.showing = true;
    this.root.replaceChildren();
    const card = el("div", `alert anim-${next.animation}`);
    card.append(el("div", "alert-emoji", next.emoji), el("div", "alert-title", next.title));
    if (next.name || next.amount) card.append(el("div", "alert-name", [next.name, next.amount].filter(Boolean).join(" · ")));
    this.root.append(card);
    window.setTimeout(() => this.playNext(), SHOW_MS);
  }

  private renderLeaderboard(message: OverlayMessage): void {
    const model = leaderboardModel(message);
    this.root.replaceChildren();
    if (!model) return;
    const card = el("div", "poll leaderboard");
    card.append(el("div", "question", model.title ?? t["leaderboard.title"]));
    for (const row of model.rows) {
      const line = el("div", "lb-row");
      const name = (this.theme.showNames && row.name) || t["leaderboard.anonymous"];
      line.append(el("span", "lb-rank", `#${row.rank}`), el("span", "label", name), el("span", "count", t["leaderboard.points"](row.points)));
      card.append(line);
    }
    this.root.append(card);
  }

  private renderPoll(message: OverlayMessage): void {
    const model = pollModel(message);
    this.root.replaceChildren();
    if (!model) return;
    const card = el("div", model.closed ? "poll closed" : "poll");
    card.append(el("div", "question", model.question));
    for (const row of model.rows) {
      const line = el("div", "row");
      const track = el("div", "track");
      const bar = el("div", "bar");
      bar.style.width = `${row.percent}%`;
      track.append(bar);
      line.append(el("span", "label", row.label), track, el("span", "count", `${row.percent}%`));
      card.append(line);
    }
    card.append(el("div", "total", t["poll.total"](model.total)));
    this.root.append(card);
  }
}

const panels = new Map<PanelWidget, Panel>();

// Panels sharing a corner stack in a fixed order, so the layout doesn't jump when one is restyled.
function layout(): void {
  for (const widget of PANEL_ORDER) {
    const panel = panels.get(widget);
    if (panel) slots.get(panel.position)!.append(panel.root);
  }
}

function mount(widgets: readonly PanelWidget[]): void {
  for (const widget of widgets) panels.set(widget, new Panel(widget));
  layout();
}

function only(): Panel | undefined {
  return panels.size === 1 ? panels.values().next().value : undefined;
}

function render(message: OverlayMessage): void {
  if (message.type === "config") {
    const panel = message.widget ? panels.get(message.widget) : only();
    panel?.configure(message.config);
    layout();
    return;
  }
  if (message.type === "alert") return panels.get("alerts")?.alert(message);
  panels.get(message.type)?.show(message);
}

function connect(target: { token: string; widget: string }, attempt = 0): void {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${proto}//${location.host}/o/${target.token}/${target.widget}/ws`);
  let opened = false;
  socket.addEventListener("open", () => {
    opened = true;
  });
  socket.addEventListener("message", (event) => {
    const message = parseMessage(event.data);
    if (message) render(message);
  });
  socket.addEventListener("close", (event) => {
    if (!shouldReconnect(event.code)) {
      for (const panel of panels.values()) panel.clear();
      return;
    }
    const next = opened ? 0 : attempt + 1;
    window.setTimeout(() => connect(target, next), backoffMs(next));
  });
}

const SCENE_PREVIEW_POSITIONS: Record<PanelWidget, OverlayTheme["position"]> = { poll: "top-left", leaderboard: "top-right", alerts: "bottom-right" };

function samples(widgets: readonly PanelWidget[]): void {
  if (widgets.includes("poll")) {
    render({ type: "poll", live: true, poll: { question: t["preview.question"], options: [...t["preview.options"]], counts: [48, 31, 21], total: 100, status: "open" } });
  }
  if (widgets.includes("leaderboard")) {
    render({ type: "leaderboard", live: true, title: t["preview.season"], entries: t["preview.names"].map((name, i) => ({ rank: i + 1, name, points: 120 - i * 25 })) });
  }
  if (widgets.includes("alerts")) {
    const sample = () => render({ type: "alert", alert: { source: "command", title: t["preview.alert"], name: t["preview.names"][0]!, sticker: "heart", animation: "bounce" } });
    sample();
    window.setInterval(sample, SHOW_MS * 2);
  }
}

function preview(widget: PanelWidget | "scene"): void {
  if (widget === "scene") {
    mount(PANEL_ORDER);
    for (const w of PANEL_ORDER) render({ type: "config", widget: w, config: { theme: { ...DEFAULT_THEME, position: SCENE_PREVIEW_POSITIONS[w] } } });
    samples(PANEL_ORDER);
    return;
  }
  mount([widget]);
  const showConfig = () => {
    const config = decodePreview(location.hash) as { alerts?: AlertsConfigView };
    render({ type: "config", config: { theme: themeFrom(config), ...(widget === "alerts" && config.alerts ? { alerts: config.alerts } : {}) } });
  };
  showConfig();
  window.addEventListener("hashchange", showConfig);
  samples([widget]);
}

const target = parseOverlayPath(location.pathname);
const previewWidget = new URLSearchParams(location.search).get("preview");
if (target) {
  mount(target.widget === "scene" ? PANEL_ORDER : [target.widget as PanelWidget]);
  connect(target);
} else if (previewWidget === "poll" || previewWidget === "leaderboard" || previewWidget === "alerts" || previewWidget === "scene") {
  preview(previewWidget);
}
