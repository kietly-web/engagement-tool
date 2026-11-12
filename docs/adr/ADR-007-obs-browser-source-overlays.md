# ADR-007 Overlays as OBS browser sources with per-widget secret tokens

Status: Accepted · 2026-11-08

## Context

Results must appear on stream without writing to YouTube (ADR-004). Creators already add Streamlabs/StreamElements-style browser sources. A leaked URL or hostile chat text can reach a live audience (R5).

## Decision

- `apps/overlay` serves one page per widget (poll, leaderboard, game) at `/o/<token>/<widget>`. The token is 32 random bytes, base64url, stored as SHA-256 in `app.overlay_token`. It's shown to the owner once, at creation or rotation; rotating closes existing sockets with code 4001. Only owners create or rotate links. Moderators see whether a link exists, never the link itself.
- Overlay pages open a read-only WebSocket (`/o/<token>/<widget>/ws`) that the Worker forwards to the workspace's `LiveSession` after resolving the token. It uses the hibernation API, allows at most 20 sockets per widget, and ignores anything a client sends. The server builds every message with `overlayView()`: question, options, counts, total, status, and leaderboard ranks and points. Never viewer IDs. Display names appear only on the leaderboard and are removed on the server (`forSocket()`) for sockets whose widget has `showNames` off, so the link holder never receives them.
- Styling (ET-13) comes only from fixed presets, palette keys and clamped numbers, validated by `parseWidgetConfig()` on the server and again in the overlay; the overlay maps them to CSS it owns. The config reaches the overlay as the first socket message and is pushed again when the owner saves. The dashboard previews the real overlay page in a same-origin iframe (`/overlay/?preview=<widget>#<config>`, sample data, no socket); only `/overlay/*` allows `frame-ancestors 'self'`.
- Chat-derived text is set with `textContent` only, length-capped, with control and bidi-override characters stripped. Strict CSP, no third-party scripts, `Referrer-Policy: no-referrer`.

## Consequences

- Nothing is installed on the creator's PC; works in OBS, Streamlabs Desktop and any browser source.
- A leaked URL lets someone watch the widget, nothing more; rotation fixes it.
- Tokens are bearer secrets in URLs, so overlay requests must never be logged with their path.

## Alternatives considered

- OBS plugin or desktop app: per-OS builds and much more trust asked of creators.
- Signed short-lived URLs: OBS keeps URLs for months; rotation on demand fits better.
