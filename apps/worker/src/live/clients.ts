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
}

export interface QuotaUsageClient extends QuotaClient {
  usage(workspaceId: string): Promise<QuotaUsage>;
  reserveDemo(workspaceId: string): Promise<boolean>;
}

// One LiveSession per workspace, named on the server from the workspace id (non-negotiable 4).
export function liveSessionClient(env: AppEnv, workspaceId: string): SessionClient {
  return env.LIVE_SESSION.get(env.LIVE_SESSION.idFromName(`workspace:${workspaceId}`)) as unknown as SessionClient;
}

export function overlaySocket(env: AppEnv, workspaceId: string, widget: OverlayWidget, request: Request): Promise<Response> {
  const stub = env.LIVE_SESSION.get(env.LIVE_SESSION.idFromName(`workspace:${workspaceId}`));
  return stub.fetch(new Request(`https://live-session/overlay?widget=${widget}`, request));
}

export function quotaClient(env: AppEnv): QuotaUsageClient {
  return env.QUOTA.get(env.QUOTA.idFromName("global")) as unknown as QuotaUsageClient;
}

export function googleCredentials(env: AppEnv): GoogleCredentials | null {
  return env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.TOKEN_ENCRYPTION_KEY
    ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, tokenEncryptionKey: env.TOKEN_ENCRYPTION_KEY }
    : null;
}
