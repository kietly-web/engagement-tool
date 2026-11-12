import { isChannelId, type ChatMessage } from "@et/core";
import { ChatSourceError, type ActiveLiveChat, type ChatPage, type ChatSource, type ChatSourceErrorKind } from "./chat-source";
import type { FetchLike, HttpResponse } from "./http";

export const QUOTA_UNITS = {
  liveBroadcastsList: 1,
  liveChatMessagesList: 5,
} as const;

const API = "https://www.googleapis.com/youtube/v3";
const MIN_WAIT_MS = 1_000;
const MAX_TEXT = 500;

export interface YoutubeChatSourceDeps {
  fetch: FetchLike;
  accessToken(): Promise<string>;
  reserveQuota(units: number): Promise<boolean>;
}

async function errorKind(res: HttpResponse): Promise<ChatSourceErrorKind> {
  if (res.status === 401) return "unauthorized";
  const reason = await res
    .json()
    .then((body) => (body as { error?: { errors?: { reason?: string }[] } }).error?.errors?.[0]?.reason ?? "")
    .catch(() => "");
  if (["liveChatEnded", "liveChatDisabled", "liveChatNotFound"].includes(reason) || res.status === 404) return "ended";
  if (["quotaExceeded", "dailyLimitExceeded"].includes(reason)) return "quota";
  if (["rateLimitExceeded", "userRateLimitExceeded"].includes(reason)) return "rate_limited";
  return "unavailable";
}

type RawItem = {
  snippet?: {
    type?: unknown;
    publishedAt?: unknown;
    displayMessage?: unknown;
    textMessageDetails?: { messageText?: unknown };
    superChatDetails?: { amountDisplayString?: unknown; userComment?: unknown };
    superStickerDetails?: { amountDisplayString?: unknown };
    membershipGiftingDetails?: { giftMembershipsCount?: unknown };
  };
  authorDetails?: { channelId?: unknown; displayName?: unknown };
};

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

// Paid and membership events become donation messages with empty text, so they can never act as commands (ADR-008).
function donationFrom(s: NonNullable<RawItem["snippet"]>): ChatMessage["donation"] | null {
  switch (s.type) {
    case "superChatEvent":
      return { kind: "super_chat", amount: str(s.superChatDetails?.amountDisplayString, 20) || null, comment: str(s.superChatDetails?.userComment, MAX_TEXT) };
    case "superStickerEvent":
      return { kind: "super_sticker", amount: str(s.superStickerDetails?.amountDisplayString, 20) || null, comment: "" };
    case "newSponsorEvent":
      return { kind: "membership", amount: null, comment: "" };
    case "membershipGiftingEvent": {
      const n = s.membershipGiftingDetails?.giftMembershipsCount;
      return { kind: "membership_gift", amount: typeof n === "number" && Number.isInteger(n) && n > 0 ? `×${Math.min(n, 999)}` : null, comment: "" };
    }
    default:
      return null;
  }
}

// Keeps only the four fields the engine needs; avatars and every other author field are dropped here.
export function toChatMessage(item: RawItem): ChatMessage | null {
  const s = item.snippet;
  const a = item.authorDetails;
  if (!s || typeof a?.channelId !== "string" || !isChannelId(a.channelId)) return null;
  const donation = donationFrom(s);
  if (donation) {
    return {
      channelId: a.channelId,
      displayName: typeof a.displayName === "string" ? a.displayName.slice(0, 100) : "",
      text: "",
      publishedAt: typeof s.publishedAt === "string" ? s.publishedAt : "",
      donation,
    };
  }
  if (s.type !== "textMessageEvent") return null;
  const text = typeof s.textMessageDetails?.messageText === "string" ? s.textMessageDetails.messageText : s.displayMessage;
  if (typeof text !== "string") return null;
  return {
    channelId: a.channelId,
    displayName: typeof a.displayName === "string" ? a.displayName.slice(0, 100) : "",
    text: text.slice(0, MAX_TEXT),
    publishedAt: typeof s.publishedAt === "string" ? s.publishedAt : "",
  };
}

export class YoutubeChatSource implements ChatSource {
  constructor(private readonly deps: YoutubeChatSourceDeps) {}

  private async get(url: string, units: number): Promise<unknown> {
    if (!(await this.deps.reserveQuota(units))) throw new ChatSourceError("quota");
    const token = await this.deps.accessToken();
    let res: HttpResponse;
    try {
      res = await this.deps.fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    } catch {
      throw new ChatSourceError("unavailable");
    }
    if (!res.ok) throw new ChatSourceError(await errorKind(res));
    return res.json();
  }

  async findActiveLiveChat(): Promise<ActiveLiveChat | null> {
    const body = (await this.get(`${API}/liveBroadcasts?part=snippet&broadcastStatus=active&maxResults=5`, QUOTA_UNITS.liveBroadcastsList)) as {
      items?: { id?: unknown; snippet?: { liveChatId?: unknown } }[];
    };
    const item = body.items?.find((i) => typeof i.id === "string" && typeof i.snippet?.liveChatId === "string");
    return item ? { broadcastId: item.id as string, liveChatId: item.snippet!.liveChatId as string } : null;
  }

  async fetchPage(liveChatId: string, pageToken?: string): Promise<ChatPage> {
    const params = new URLSearchParams({ liveChatId, part: "snippet,authorDetails", maxResults: "2000" });
    if (pageToken) params.set("pageToken", pageToken);
    const body = (await this.get(`${API}/liveChat/messages?${params}`, QUOTA_UNITS.liveChatMessagesList)) as {
      items?: RawItem[];
      nextPageToken?: unknown;
      pollingIntervalMillis?: unknown;
      offlineAt?: unknown;
    };
    if (typeof body.offlineAt === "string") throw new ChatSourceError("ended");
    const interval = typeof body.pollingIntervalMillis === "number" ? body.pollingIntervalMillis : 5_000;
    return {
      messages: (body.items ?? []).map(toChatMessage).filter((m): m is ChatMessage => m !== null),
      nextPageToken: typeof body.nextPageToken === "string" ? body.nextPageToken : pageToken ?? "",
      waitMs: Math.max(interval, MIN_WAIT_MS),
    };
  }
}
