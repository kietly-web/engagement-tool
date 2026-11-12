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

export type SessionMode = "youtube" | "demo";
export type StopReason = "manual" | "broadcast_ended" | "quota" | "reconnect_required" | "youtube_unavailable" | "demo_finished" | "disabled" | "internal_error";

export interface PollView {
  question: string;
  options: string[];
  status: "draft" | "open" | "closed";
  voteChange: "first" | "latest";
  counts: number[];
  total: number;
}

export interface LeaderboardEntry {
  rank: number;
  name: string | null;
  points: number;
}

export interface SessionStatus {
  status: "idle" | "live" | "stopped";
  mode?: SessionMode;
  startedAt?: string;
  stoppedAt?: string;
  stopReason?: StopReason;
  messagesSeen: number;
  poll: PollView | null;
  season?: string | null;
  leaderboard?: LeaderboardEntry[];
  overlayConnections?: number;
}

export interface QuotaView {
  day: string;
  workspaceUsed: number;
  workspaceLimit: number;
  projectHeadroomLow: boolean;
  demoStartsLeft: number;
}

export interface SessionResponse {
  session: SessionStatus;
  quota: QuotaView;
}

export type SessionStartError = "not_connected" | "not_live" | "reconnect_required" | "quota_exhausted" | "youtube_unavailable" | "already_live" | "disabled" | "demo_limit";

export type OverlayWidget = "poll" | "leaderboard" | "game" | "alerts" | "scene";

export interface OverlayPollMessage {
  type: "poll";
  live: boolean;
  poll: { question: string; options: string[]; counts: number[]; total: number; status: "open" | "closed" } | null;
}

export interface OverlayLeaderboardMessage {
  type: "leaderboard";
  live: boolean;
  title: string | null;
  entries: LeaderboardEntry[];
}

export interface OverlayTheme {
  preset: "night" | "day" | "neon" | "pastel";
  accent: "pink" | "orange" | "yellow" | "green" | "teal" | "blue" | "purple" | "red";
  fontScale: number;
  position: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";
  opacity: number;
  showTitle: boolean;
  showTotal: boolean;
  showNames: boolean;
}

export type AlertSticker = "heart" | "fire" | "clap" | "star" | "laugh" | "wave" | "gift" | "sparkles";
export type AlertAnimation = "pop" | "slide" | "bounce" | "shake";

export interface AlertCommandView {
  trigger: string;
  text: string;
  sticker: AlertSticker;
  animation: AlertAnimation;
}

export interface AlertsConfigView {
  commands: AlertCommandView[];
  viewerCooldownSeconds: number;
  globalCooldownSeconds: number;
  showHint: boolean;
  donations: { superChats: boolean; memberships: boolean; showAmount: boolean; showComment: boolean };
}

export interface OverlayConfigMessage {
  type: "config";
  // Present on scene sockets, which carry several widgets' configs.
  widget?: "poll" | "leaderboard" | "alerts";
  config: { theme: OverlayTheme; alerts?: AlertsConfigView };
}

export interface ObsLinkResponse {
  url: string;
  dragUrl: string;
}

export interface OverlayAlertMessage {
  type: "alert";
  alert: { source: "command" | "super_chat" | "membership" | "test"; title: string; name: string | null; sticker: AlertSticker; animation: AlertAnimation; amount?: string };
}

export type OverlayMessage = OverlayPollMessage | OverlayLeaderboardMessage | OverlayConfigMessage | OverlayAlertMessage;

export interface OverlayLinkView {
  widget: OverlayWidget;
  rotatedAt: string | null;
}

export interface OverlayRotateResponse {
  widget: OverlayWidget;
  url: string;
}
