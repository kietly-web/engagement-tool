import type { OverlayMessage, OverlayWidget, SessionStatus } from "../api-types";

// Exactly what an overlay draws: never viewer ids; display names only where the widget shows them (non-negotiable 5).
export function overlayView(widget: OverlayWidget, status: SessionStatus): OverlayMessage | null {
  if (widget === "leaderboard") {
    return {
      type: "leaderboard",
      live: status.status === "live",
      title: status.season ?? null,
      entries: (status.leaderboard ?? []).slice(0, 10).map((e) => ({ rank: e.rank, name: e.name, points: e.points })),
    };
  }
  if (widget !== "poll") return null;
  const poll = status.poll;
  return {
    type: "poll",
    live: status.status === "live",
    poll:
      poll && poll.status !== "draft"
        ? { question: poll.question, options: [...poll.options], counts: [...poll.counts], total: poll.total, status: poll.status }
        : null,
  };
}

// Hidden names are removed before sending, not just hidden by the page, so the link holder never receives them.
export function forSocket(message: OverlayMessage | null, showNames: boolean): OverlayMessage | null {
  if (!message || showNames) return message;
  if (message.type === "leaderboard") return { ...message, entries: message.entries.map((e) => ({ ...e, name: null })) };
  if (message.type === "alert") return { ...message, alert: { ...message.alert, name: null } };
  return message;
}
