# ADR-003 Google sign-in for creators and moderators, own session cookie

Status: Accepted · 2026-11-08

## Context

Creators must grant YouTube read access anyway (FR-01). Moderators need accounts too (FR-02). Viewers never sign in (non-negotiable 2). No paid auth vendor (ADR-005).

## Decision

- OAuth 2.0 authorization-code flow with PKCE (S256) and a nonce against Google, implemented in `apps/worker/src/google.ts`. It's a small in-repo client with an injectable `fetch`, so the whole flow is tested against a fake Google. No hosted auth service. The ID token is accepted only straight from Google's token endpoint over TLS (OIDC Core 3.1.3.7). We check `iss`, `aud`/`azp`, `exp`, `nonce`, `sub`, and require `email_verified`.
- Creators request `openid email profile https://www.googleapis.com/auth/youtube.readonly` with offline access. Moderators request `openid email profile` only.
- We keep the Google subject ID, email and name. We drop the profile photo. The creator's refresh token is encrypted with AES-GCM using `TOKEN_ENCRYPTION_KEY`, with the workspace ID as associated data, before it reaches Postgres. Access tokens are never stored. Granted scopes are checked: without `youtube.readonly` the creator is signed in but gets no workspace.
- Sessions are opaque random 256-bit tokens in a `__Host-et_session` cookie (`Secure`, `HttpOnly`, `SameSite=Lax`). They're stored as an HMAC with `SESSION_SECRET` and expire after 7 days idle or 30 days absolute. OAuth state, PKCE verifier, nonce and intent travel in a signed, single-use `__Host-et_oauth` cookie that lasts 10 minutes. State-changing API calls must carry a same-origin `Origin` header.
- Moderator invites bind to a verified Google email; an invite link alone grants nothing.

## Consequences

- `youtube.readonly` is a sensitive scope: the beta runs in Google's Testing mode (100 test users, refresh tokens expire after 7 days), so the dashboard must handle re-consent gracefully. Verification is a launch-readiness item (R4).
- Disconnect revokes the token at `oauth2.googleapis.com/revoke` before deleting it (FR-09).
- Preview deployments can't use Google sign-in unless each preview URL is registered; previews use a dev-only sign-in stub that is compiled out of production builds.

## Alternatives considered

- Better Auth (self-hosted or Neon-managed), Clerk, Auth0: an extra sub-processor or a framework with its own tables for a single Google provider; vendor free tiers can change; tokens for YouTube still need our own handling.
- Email magic links: needs an email provider and doesn't grant YouTube access.
