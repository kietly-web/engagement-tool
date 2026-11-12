export interface DonationInfo {
  kind: "super_chat" | "super_sticker" | "membership" | "membership_gift";
  amount: string | null;
  comment: string;
}

export interface ChatMessage {
  channelId: string;
  displayName: string;
  text: string;
  publishedAt: string;
  // Set for YouTube's paid or membership events; these never reach the command parser (ADR-008).
  donation?: DonationInfo;
}
