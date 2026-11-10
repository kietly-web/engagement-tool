import type { OverlayMessage } from "@et/worker/api-types";
import { backoffMs, gameModel, leaderboardModel, parseMessage, parseOverlayPath, pollModel, shouldReconnect } from "./model";
import { t } from "./i18n";
import "./overlay.css";

const root = document.getElementById("widget")!;

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
    line.append(el("span", "lb-rank", `#${row.rank}`), el("span", "label", row.name ?? t["leaderboard.anonymous"]), el("span", "count", t["leaderboard.points"](row.points)));
    card.append(line);
  }
  root.append(card);
}

function renderGame(message: OverlayMessage): void {
  const model = gameModel(message);
  root.replaceChildren();
  if (!model) return;
  const card = el("div", "poll game");
  card.append(el("div", "question", t["game.title"](model.range[0], model.range[1])));
  if (model.status === "won" && model.secret !== null) {
    card.append(el("div", "game-result", t["game.won"](model.winnerName ?? t["game.someone"], model.secret)));
  } else if (model.status === "closed" && model.secret !== null) {
    card.append(el("div", "game-result", t["game.closed"](model.secret)));
  } else {
    card.append(el("div", "game-hint", model.lastGuess ? t[model.lastGuess.hint === "higher" ? "game.higher" : "game.lower"](model.lastGuess.value) : t["game.howto"]));
  }
  card.append(el("div", "total", t["game.guesses"](model.guesses)));
  root.append(card);
}

function render(message: OverlayMessage): void {
  if (message.type === "leaderboard") return renderLeaderboard(message);
  if (message.type === "game") return renderGame(message);
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

const target = parseOverlayPath(location.pathname);
if (target) connect(target);
