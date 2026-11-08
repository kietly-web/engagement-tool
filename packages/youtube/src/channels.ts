import { isChannelId } from "@et/core";
import type { FetchLike } from "./http";

export const CHANNELS_MINE_URL = "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&maxResults=1";
export const CHANNELS_LIST_QUOTA_UNITS = 1;

export interface ChannelSummary {
  id: string;
  title: string;
}

export class YoutubeApiError extends Error {
  constructor(readonly status: number) {
    super(`YouTube API responded ${status}`);
    this.name = "YoutubeApiError";
  }
}

export async function fetchMyChannel(accessToken: string, fetchFn: FetchLike): Promise<ChannelSummary | null> {
  const res = await fetchFn(CHANNELS_MINE_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new YoutubeApiError(res.status);
  const body = (await res.json()) as { items?: { id?: unknown; snippet?: { title?: unknown } }[] };
  const item = body.items?.[0];
  if (!item || typeof item.id !== "string" || !isChannelId(item.id)) return null;
  const title = typeof item.snippet?.title === "string" && item.snippet.title.trim() ? item.snippet.title.trim().slice(0, 200) : item.id;
  return { id: item.id, title };
}
