import type { MeResponse, OverlayLinkView, OverlayRotateResponse, OverlayWidget, SessionMode, SessionResponse, WorkspaceResponse } from "@et/worker/api-types";

export interface SeasonView {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
}

export interface LeaderboardRow {
  rank: number;
  points: number;
  joins: number;
  votes: number;
  channelId?: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null = null,
  ) {
    super(`HTTP ${status}`);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", ...init });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    throw new ApiError(res.status, typeof body?.error === "string" ? body.error : null);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  me: () => call<MeResponse>("/api/me"),
  workspace: (id: string) => call<WorkspaceResponse>(`/api/workspaces/${encodeURIComponent(id)}`),
  disconnect: (id: string) => call<void>(`/api/workspaces/${encodeURIComponent(id)}/youtube/disconnect`, { method: "POST" }),
  logout: () => call<void>("/api/auth/logout", { method: "POST" }),
  deleteAccount: () => call<void>("/api/account", { method: "DELETE" }),
  session: (id: string) => call<SessionResponse>(`/api/workspaces/${encodeURIComponent(id)}/session`),
  startSession: (id: string, mode: SessionMode) => call<SessionResponse>(`/api/workspaces/${encodeURIComponent(id)}/session`, jsonBody("POST", { mode })),
  stopSession: (id: string) => call<SessionResponse>(`/api/workspaces/${encodeURIComponent(id)}/session`, { method: "DELETE" }),
  openPoll: (id: string, poll: { question: string; options: string[]; voteChange: "first" | "latest" }) =>
    call<SessionResponse>(`/api/workspaces/${encodeURIComponent(id)}/session/poll`, jsonBody("POST", poll)),
  overlays: (id: string) => call<{ overlays: OverlayLinkView[] }>(`/api/workspaces/${encodeURIComponent(id)}/overlays`),
  rotateOverlay: (id: string, widget: OverlayWidget) =>
    call<OverlayRotateResponse>(`/api/workspaces/${encodeURIComponent(id)}/overlays/${widget}/rotate`, { method: "POST" }),
  seasons: (id: string) =>
    call<{ active: SeasonView | null; recent: SeasonView[] }>(`/api/workspaces/${encodeURIComponent(id)}/seasons`),
  startSeason: (id: string, name: string, days: number) => call<SeasonView>(`/api/workspaces/${encodeURIComponent(id)}/seasons`, jsonBody("POST", { name, days })),
  endSeason: (id: string) => call<void>(`/api/workspaces/${encodeURIComponent(id)}/seasons/end`, { method: "POST" }),
  leaderboard: (id: string) => call<{ entries: LeaderboardRow[] }>(`/api/workspaces/${encodeURIComponent(id)}/leaderboard`),
  eraseViewer: (id: string, channelId: string) =>
    call<{ removedRows: number }>(`/api/workspaces/${encodeURIComponent(id)}/viewers/${encodeURIComponent(channelId)}`, { method: "DELETE" }),
  invite: (id: string, email: string) => call<{ url: string }>(`/api/workspaces/${encodeURIComponent(id)}/invites`, jsonBody("POST", { email })),
  invites: (id: string) =>
    call<{ invites: { id: string; email: string; expiresAt: string }[] }>(`/api/workspaces/${encodeURIComponent(id)}/invites`),
  revokeInvite: (id: string, inviteId: string) =>
    call<void>(`/api/workspaces/${encodeURIComponent(id)}/invites/${encodeURIComponent(inviteId)}`, { method: "DELETE" }),
  removeMember: (id: string, memberId: string) =>
    call<void>(`/api/workspaces/${encodeURIComponent(id)}/members/${encodeURIComponent(memberId)}`, { method: "DELETE" }),
  audit: (id: string) =>
    call<{ events: { action: string; actorName: string | null; createdAt: string }[] }>(`/api/workspaces/${encodeURIComponent(id)}/audit`),
  previewInvite: (token: string) => call<{ workspaceName: string }>("/api/invites/preview", jsonBody("POST", { token })),
  acceptInvite: (token: string) => call<{ workspaceId: string; outcome: string }>("/api/invites/accept", jsonBody("POST", { token })),
  closePoll: (id: string) => call<SessionResponse>(`/api/workspaces/${encodeURIComponent(id)}/session/poll/close`, { method: "POST" }),
};

function jsonBody(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export const signInUrl = (intent: "creator" | "moderator") => `/api/auth/google/start?intent=${intent}`;
