import type { ChatMessage } from "@et/core";

export interface ChatPage {
  messages: ChatMessage[];
  nextPageToken: string;
  waitMs: number;
}

export interface ActiveLiveChat {
  broadcastId: string;
  liveChatId: string;
}

export type ChatSourceErrorKind = "ended" | "quota" | "rate_limited" | "unauthorized" | "unavailable";

export class ChatSourceError extends Error {
  constructor(readonly kind: ChatSourceErrorKind) {
    super(kind);
    this.name = "ChatSourceError";
  }
}

// Read-only by design (ADR-004): add no method that writes to YouTube.
export interface ChatSource {
  findActiveLiveChat(): Promise<ActiveLiveChat | null>;
  fetchPage(liveChatId: string, pageToken?: string): Promise<ChatPage>;
}
