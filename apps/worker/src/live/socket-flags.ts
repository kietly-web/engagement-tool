export type ContentWidget = "poll" | "leaderboard" | "alerts";
export const CONTENT_WIDGETS: readonly ContentWidget[] = ["poll", "leaderboard", "alerts"];

export interface SocketAttachment {
  names: Partial<Record<ContentWidget, boolean>>;
}

// A scene socket carries several widgets; each keeps its own "show names" choice. Missing means hidden (fail closed).
export function showsNamesFor(attachment: unknown, content: ContentWidget): boolean {
  const names = (attachment as SocketAttachment | null)?.names;
  return names?.[content] === true;
}

export function withNamesFlag(attachment: unknown, content: ContentWidget, show: boolean): SocketAttachment {
  const names = { ...((attachment as SocketAttachment | null)?.names ?? {}) };
  names[content] = show;
  return { names };
}
