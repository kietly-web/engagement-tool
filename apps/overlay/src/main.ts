import type { AlertsConfigView, OverlayMessage } from "@et/worker/api-types";
import { backoffMs, leaderboardModel, parseMessage, parseOverlayPath, pollModel, shouldReconnect } from "./model";
import { applyTheme, decodePreview, DEFAULT_THEME, themeFrom } from "./theme";
import { AlertQueue, alertView, hintTriggers, SHOW_MS, type AlertView } from "./alerts";
import { t } from "./i18n";
import "./overlay.css";

const root = document.getElementById("widget")!;
let showNames = DEFAULT_THEME.showNames;
let lastContent: OverlayMessage | null = null;
let hint: string[] = [];
const queue = new AlertQueue<AlertView>();
let showing = false;

function renderHint(): void {
  root.replaceChildren();
  if (hint.length > 0) root.append(el("div", "alert-hint", t["alerts.hint"](hint)));
}

function playNext(): void {
  const next = queue.next();
  if (!next) {
    showing = false;
    renderHint();
    return;
  }
  showing = true;
  root.replaceChildren();
  const card = el("div", `alert anim-${next.animation}`);
  card.append(el("div", "alert-emoji", next.emoji), el("div", "alert-title", next.title));
  if (next.name || next.amount) card.append(el("div", "alert-name", [next.name, next.amount].filter(Boolean).join(" · ")));
  root.append(card);
  window.setTimeout(playNext, SHOW_MS);
}
applyTheme(document.body, DEFAULT_THEME);

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderLeaderboard(message: OverlayMessage): void {
  const model = leaderboardModel(message);
  root.replaceChildren();
  if (!model) return;
  const card = el("div", "poll leaderboard");
  card.append(el("div", "question", model.title ?? t["leaderboard.title"]));
  for (const row of model.rows) {
    const line = el("div", "lb-row");
    line.append(el("span", "lb-rank", `#${row.rank}`), el("span", "label", (showNames && row.name) || t["leaderboard.anonymous"]), el("span", "count", t["leaderboard.points"](row.points)));
    card.append(line);
  }
  root.append(card);
}

function render(message: OverlayMessage): void {
  if (message.type === "config") {
    const theme = themeFrom(message.config);
    showNames = theme.showNames;
    applyTheme(document.body, theme);
    hint = hintTriggers(message.config.alerts);
    if (isAlertsWidget && !showing) renderHint();
    if (lastContent) render(lastContent);
    return;
  }
  if (message.type === "alert") {
    const view = alertView(message, { test: t["alerts.testTitle"], superChat: t["alerts.superChat"], membership: t["alerts.membership"] });
    if (!view) return;
    queue.push(showNames ? view : { ...view, name: null });
    if (!showing) playNext();
    return;
  }
  lastContent = message;
  if (message.type === "leaderboard") return renderLeaderboard(message);
  const model = pollModel(message);
  root.replaceChildren();
  if (!model) return;
  const card = el("div", model.closed ? "poll closed" : "poll");
  card.append(el("div", "question", model.question));
  for (const row of model.rows) {
    const line = el("div", "row");
    const bar = el("div", "bar");
    bar.style.width = `${row.percent}%`;
    line.append(el("span", "label", row.label), el("div", "track"), el("span", "count", `${row.percent}%`));
    line.querySelector(".track")!.append(bar);
    card.append(line);
  }
  card.append(el("div", "total", t["poll.total"](model.total)));
  root.append(card);
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
      root.replaceChildren();
      return;
    }
    const next = opened ? 0 : attempt + 1;
    window.setTimeout(() => connect(target, next), backoffMs(next));
  });
}

function preview(widget: string): void {
  const showConfig = () => render({ type: "config", config: { theme: themeFrom(decodePreview(location.hash)) } });
  if (widget === "alerts") {
    const showConfig = () => {
      const config = decodePreview(location.hash) as { alerts?: AlertsConfigView };
      render({ type: "config", config: { theme: themeFrom(config), ...(config.alerts ? { alerts: config.alerts } : {}) } });
    };
    showConfig();
    window.addEventListener("hashchange", showConfig);
    const sample = () => render({ type: "alert", alert: { source: "command", title: t["preview.alert"], name: t["preview.names"][0]!, sticker: "heart", animation: "bounce" } });
    sample();
    window.setInterval(sample, SHOW_MS * 2);
    return;
  }
  if (widget === "leaderboard") {
    render({
      type: "leaderboard",
      live: true,
      title: t["preview.season"],
      entries: t["preview.names"].map((name, i) => ({ rank: i + 1, name, points: 120 - i * 25 })),
    });
  } else {
    render({ type: "poll", live: true, poll: { question: t["preview.question"], options: [...t["preview.options"]], counts: [48, 31, 21], total: 100, status: "open" } });
  }
  showConfig();
  window.addEventListener("hashchange", showConfig);
}

const target = parseOverlayPath(location.pathname);
const previewWidget = new URLSearchParams(location.search).get("preview");
const isAlertsWidget = target?.widget === "alerts" || previewWidget === "alerts";
if (target) connect(target);
else if (previewWidget === "poll" || previewWidget === "leaderboard" || previewWidget === "alerts") preview(previewWidget);
