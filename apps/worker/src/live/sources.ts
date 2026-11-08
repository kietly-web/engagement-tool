import type { Clock } from "@et/core";
import { ChatSourceError, DemoChatSource, YoutubeChatSource, type ChatSource, type FetchLike, type QuotaDecision } from "@et/youtube";
import { decryptFromHex, importAesKey } from "../crypto";
import { InvalidGrantError, refreshAccessToken } from "../google";
import { ReconnectRequiredError, type SessionState, type SourceProvider } from "./engine";

export interface QuotaClient {
  reserve(workspaceId: string, units: number): Promise<QuotaDecision>;
}

export interface GoogleCredentials {
  clientId: string;
  clientSecret: string;
  tokenEncryptionKey: string;
}

const EXPIRY_MARGIN_MS = 60_000;

// Access tokens live only in memory and are re-derived from the encrypted refresh token after eviction.
export class LiveSourceProvider implements SourceProvider {
  private cached: { accessToken: string; expiresAt: number } | null = null;

  constructor(
    private readonly deps: { fetch: FetchLike; quota: QuotaClient; clock: Clock; credentials: () => GoogleCredentials | null },
  ) {}

  invalidate(): void {
    this.cached = null;
  }

  async get(state: SessionState): Promise<ChatSource> {
    if (state.mode === "demo") return new DemoChatSource(Date.parse(state.startedAt) % 100_000);
    return this.youtube(state.workspaceId, state.tokenCiphertext);
  }

  youtube(workspaceId: string, tokenCiphertext: string | undefined): YoutubeChatSource {
    return new YoutubeChatSource({
      fetch: this.deps.fetch,
      accessToken: () => this.accessToken(workspaceId, tokenCiphertext),
      reserveQuota: async (units) => (await this.deps.quota.reserve(workspaceId, units)).ok,
    });
  }

  private async accessToken(workspaceId: string, tokenCiphertext: string | undefined): Promise<string> {
    const now = this.deps.clock.now().getTime();
    if (this.cached && this.cached.expiresAt - EXPIRY_MARGIN_MS > now) return this.cached.accessToken;
    const creds = this.deps.credentials();
    if (!creds || !tokenCiphertext) throw new ReconnectRequiredError();
    let refreshToken: string;
    try {
      refreshToken = await decryptFromHex(await importAesKey(creds.tokenEncryptionKey), tokenCiphertext, workspaceId);
    } catch {
      throw new ReconnectRequiredError();
    }
    try {
      const { accessToken, expiresInSeconds } = await refreshAccessToken(this.deps.fetch, {
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
        refreshToken,
      });
      this.cached = { accessToken, expiresAt: now + expiresInSeconds * 1000 };
      return accessToken;
    } catch (error) {
      if (error instanceof InvalidGrantError) throw new ReconnectRequiredError();
      throw new ChatSourceError("unavailable");
    }
  }
}
