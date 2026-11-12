import type { PollInput } from "@et/core";
import type { QuotaUsage } from "@et/youtube";
import type { OverlayWidget, SessionStatus } from "../api-types";
import type { AppEnv } from "../env";
import type { Result, StartInput, StopReason } from "./engine";
import type { GoogleCredentials, QuotaClient } from "./sources";

export interface SessionClient {
  start(input: StartInput): Promise<Result<SessionStatus>>;
  stop(reason?: StopReason): Promise<SessionStatus>;
  status(): Promise<SessionStatus>;
  createPoll(input: PollInput): Promise<Result<SessionStatus>>;
  closePoll(): Promise<Result<SessionStatus>>;
  purge(): Promise<void>;
  closeOverlays(widget: OverlayWidget): Promise<void>;
  eraseViewer(channelId: string): Promise<void>;
  stopIfStartedBy(memberId: string): Promise<boolean>;
  configChanged(widget: OverlayWidget, config: object): Promise<void>;
  testAlert(): Promise<boolean>;
  flushNow(): Promise<void>;
}

export interface QuotaUsageClient extends QuotaClient {
  usage(workspaceId: string): Promise<QuotaUsage>;
  reserveDemo(workspaceId: string): Promise<boolean>;
}

// One LiveSession per workspace, named on the server from the workspace id (non-negotiable 4).
export function liveSessionClient(env: AppEnv, workspaceId: string): SessionClient {
  return env.LIVE_SESSION.get(env.LIVE_SESSION.idFromName(`workspace:${workspaceId}`)) as unknown as SessionClient;
}

export const OVERLAY_CONFIG_HEADER = "X-ET-Widget-Config";

export function overlaySocket(env: AppEnv, workspaceId: string, widget: OverlayWidget, request: Request, config: object): Promise<Response> {
  const stub = env.LIVE_SESSION.get(env.LIVE_SESSION.idFromName(`workspace:${workspaceId}`));
  const forwarded = new Request(`https://live-session/overlay?widget=${widget}`, request);
  // Always overwritten here, so a client can't inject its own config header.
  forwarded.headers.set(OVERLAY_CONFIG_HEADER, JSON.stringify(config));
  return stub.fetch(forwarded);
}

export function quotaClient(env: AppEnv): QuotaUsageClient {
  return env.QUOTA.get(env.QUOTA.idFromName("global")) as unknown as QuotaUsageClient;
}

export function googleCredentials(env: AppEnv): GoogleCredentials | null {
  return env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.TOKEN_ENCRYPTION_KEY
    ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, tokenEncryptionKey: env.TOKEN_ENCRYPTION_KEY }
    : null;
}
