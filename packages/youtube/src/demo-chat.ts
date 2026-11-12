import { syntheticChat, type ChatMessage } from "@et/core";
import type { ActiveLiveChat, ChatPage, ChatSource } from "./chat-source";

export const DEMO_LIVE_CHAT_ID = "demo";
const PAGE_SIZE = 12;
const WAIT_MS = 2_000;

// Synthetic chat for demos and tests (non-negotiable 8); never touches YouTube or quota.
export class DemoChatSource implements ChatSource {
  constructor(
    private readonly seed: number,
    private readonly options = 4,
  ) {}

  async findActiveLiveChat(): Promise<ActiveLiveChat> {
    return { broadcastId: "demo", liveChatId: DEMO_LIVE_CHAT_ID };
  }

  async fetchPage(_liveChatId: string, pageToken?: string): Promise<ChatPage> {
    const page = Number.parseInt(pageToken ?? "0", 10) || 0;
    const all = syntheticChat({ seed: this.seed + page, count: PAGE_SIZE, viewers: 80, options: this.options, adversarial: true });
    const messages: ChatMessage[] = all.map(({ channelId, displayName, text, publishedAt }) => ({ channelId, displayName, text, publishedAt }));
    if (page % 4 === 1 && messages[0]) {
      messages.push({ ...messages[0], text: "", donation: { kind: page % 8 === 1 ? "super_chat" : "membership", amount: page % 8 === 1 ? "₫20.000" : null, comment: page % 8 === 1 ? "Ủng hộ stream nha!" : "" } });
    }
    return { messages, nextPageToken: String(page + 1), waitMs: WAIT_MS };
  }
}
