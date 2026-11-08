export interface ChatMessage {
  channelId: string;
  displayName: string;
  text: string;
  publishedAt: string;
}

export interface ChatPage {
  messages: ChatMessage[];
  nextPageToken: string;
}

// Read-only by design (ADR-004): add no method that writes to YouTube.
export interface ChatSource {
  findLiveChatId(channelId: string): Promise<string | null>;
  stream(liveChatId: string, pageToken?: string): AsyncIterable<ChatPage>;
}
