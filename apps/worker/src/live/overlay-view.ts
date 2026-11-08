import type { OverlayMessage, OverlayWidget, SessionStatus } from "../api-types";

// Exactly what an overlay draws: question, options and counts. Never viewer ids or names (non-negotiable 5).
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
