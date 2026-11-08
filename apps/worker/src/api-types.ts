export interface HealthResponse {
  ok: true;
  env: string;
}

export type Role = "owner" | "moderator";

export interface MeResponse {
  member: { id: string; email: string; displayName: string };
  workspaces: { id: string; name: string; role: Role }[];
}

export interface WorkspaceResponse {
  workspace: { id: string; name: string; role: Role };
  youtube: { channelId: string; channelTitle: string; connectedAt: string } | null;
  members: { memberId: string; displayName: string; role: Role; email: string | null }[];
}

export type SignInOutcome =
  | "denied"
  | "state"
  | "google"
  | "youtube_denied"
  | "no_refresh_token"
  | "no_channel"
  | "youtube_error"
  | "channel_in_use";

export interface ApiError {
  error: string;
}
