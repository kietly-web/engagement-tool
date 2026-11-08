# ADR-007 Overlays as OBS browser sources with per-widget secret tokens

Status: Accepted · 2026-11-08

## Context

Results must appear on stream without writing to YouTube (ADR-004). Creators already add Streamlabs/StreamElements-style browser sources. A leaked URL or hostile chat text can reach a live audience (R5).

## Decision

- `apps/overlay` serves one page per widget (poll, leaderboard, game) at `/o/<token>/<widget>`. The token is 32 random bytes, base64url, stored hashed; the creator can rotate it, which closes existing sockets.
- Overlay pages open a read-only WebSocket to the session's Durable Object, resolved on the server from the token. They receive only what is drawn on screen.
- Chat-derived text is set with `textContent` only, length-capped, with control and bidi-override characters stripped. Strict CSP, no third-party scripts, `Referrer-Policy: no-referrer`.

## Consequences

- Nothing is installed on the creator's PC; works in OBS, Streamlabs Desktop and any browser source.
- A leaked URL lets someone watch the widget, nothing more; rotation fixes it.
- Tokens are bearer secrets in URLs, so overlay requests must never be logged with their path.

## Alternatives considered

- OBS plugin or desktop app: per-OS builds and much more trust asked of creators.
- Signed short-lived URLs: OBS keeps URLs for months; rotation on demand fits better.
