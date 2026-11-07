# ADR-003 Google sign-in for creators and moderators, own session cookie

Status: Accepted · 2026-11-08

## Context

Creators must grant YouTube read access anyway (FR-01). Moderators need accounts too (FR-02). Viewers never sign in (non-negotiable 2). No paid auth vendor (ADR-005).

## Decision

- OAuth 2.0 authorization-code flow with PKCE against Google, implemented in `apps/worker` (a small, reviewed library such as `arctic` or `oslo`, no hosted auth service).
- Creators request `openid email profile https://www.googleapis.com/auth/youtube.readonly` with offline access. Moderators request `openid email profile` only.
- We keep the Google subject ID, email and name. We drop the profile photo. The creator's refresh token is encrypted with AES-GCM using `TOKEN_ENCRYPTION_KEY` before it reaches Postgres.
- Sessions are opaque random IDs in a `__Host-` cookie (`Secure`, `HttpOnly`, `SameSite=Lax`), stored hashed server-side, 7-day idle expiry. State-changing API calls also check `Origin`.
- Moderator invites bind to a verified Google email; an invite link alone grants nothing.

## Consequences

- `youtube.readonly` is a sensitive scope: the beta runs in Google's Testing mode (100 test users, refresh tokens expire after 7 days), so the dashboard must handle re-consent gracefully. Verification is a launch-readiness item (R4).
- Disconnect revokes the token at `oauth2.googleapis.com/revoke` before deleting it (FR-09).
- Preview deployments can't use Google sign-in unless each preview URL is registered; previews use a dev-only sign-in stub that is compiled out of production builds.

## Alternatives considered

- Supabase Auth, Clerk, Auth0: extra sub-processor; vendor free tiers can change; tokens for YouTube still need our own handling.
- Email magic links: needs an email provider and doesn't grant YouTube access.
