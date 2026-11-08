import type { MeResponse, WorkspaceResponse } from "@et/worker/api-types";

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", ...init });
  if (!res.ok) throw new ApiError(res.status);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  me: () => call<MeResponse>("/api/me"),
  workspace: (id: string) => call<WorkspaceResponse>(`/api/workspaces/${encodeURIComponent(id)}`),
  disconnect: (id: string) => call<void>(`/api/workspaces/${encodeURIComponent(id)}/youtube/disconnect`, { method: "POST" }),
  logout: () => call<void>("/api/auth/logout", { method: "POST" }),
  deleteAccount: () => call<void>("/api/account", { method: "DELETE" }),
};

export const signInUrl = (intent: "creator" | "moderator") => `/api/auth/google/start?intent=${intent}`;
