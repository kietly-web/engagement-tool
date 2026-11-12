# ADR-007 Overlays as OBS browser sources with per-widget secret tokens

Status: Accepted · 2026-11-08

## Context

Results must appear on stream without writing to YouTube (ADR-004). Creators already add Streamlabs/StreamElements-style browser sources. A leaked URL or hostile chat text can reach a live audience (R5).

## Decision

- `apps/overlay` serves one page per widget (poll, leaderboard, game) at `/o/<token>/<widget>`. The token is 32 random bytes, base64url, stored as SHA-256 in `app.overlay_token`. It's shown to the owner once, at creation or rotation; rotating closes existing sockets with code 4001. Only owners create or rotate links. Moderators see whether a link exists, never the link itself.
- Overlay pages open a read-only WebSocket (`/o/<token>/<widget>/ws`) that the Worker forwards to the workspace's `LiveSession` after resolving the token. It uses the hibernation API, allows at most 20 sockets per widget, and ignores anything a client sends. The server builds every message with `overlayView()`: question, options, counts, total, status, and leaderboard ranks and points. Never viewer IDs. Display names appear only on the leaderboard and are removed on the server (`forSocket()`) for sockets whose widget has `showNames` off, so the link holder never receives them.
- Styling (ET-13) comes only from fixed presets, palette keys and clamped numbers, validated by `parseWidgetConfig()` on the server and again in the overlay; the overlay maps them to CSS it owns. The config reaches the overlay as the first socket message and is pushed again when the owner saves. The dashboard previews the real overlay page in a same-origin iframe (`/overlay/?preview=<widget>#<config>`, sample data, no socket); only `/overlay/*` allows `frame-ancestors 'self'`.
- Chat-derived text is set with `textContent` only, length-capped, with control and bidi-override characters stripped. Strict CSP, no third-party scripts, `Referrer-Policy: no-referrer`.

## Amendment: one-step OBS setup (ET-23, 12/11/2026)

- A combined **scene** link (`/o/<token>/scene`) shows the poll, leaderboard and alerts widgets on one 1920×1080 page, each with its own saved style and corner. It opens one socket; the `LiveSession` sends it every widget's config and messages, and removes names per widget for widgets that hide them.
- The dashboard offers the scene link as a button the owner drags onto OBS. OBS (25+) creates a browser source from the dropped link and reads `layer-name`, `layer-width` and `layer-height` from its query string ([OBS docs](https://obsproject.com/tools/browser-drag-and-drop)). A "copy link" fallback covers OBS run as Administrator, Streamlabs and other apps.
- So the owner can see the scene link again instead of copying it once, its token is also stored encrypted (AES-GCM with `TOKEN_ENCRYPTION_KEY`, associated data `overlay:<workspace>:scene`, key-version byte), next to its SHA-256 hash, which is still what resolves a request. Only the owner can read the ciphertext, through `app.overlay_token_enc()`. Per-widget links are unchanged and stay shown once; they move under "advanced" in the dashboard. Storing this one token encrypted adds little risk: the same key already protects Google refresh tokens, and a database leak without the key still yields neither (requests resolve by hash). If the ciphertext can't be decrypted (for example after a key change), the link is replaced, its sockets closed, and the change audited, so the creator drags the new link into OBS again.
- The dashboard checks once whether OBS has the scene link open (`overlayConnections`, scene sockets only). After a drag or copy it checks every 10 s while the tab is visible, for at most 10 minutes (≤ 60 Worker requests, DO calls and short Neon transactions per setup), and stops once OBS connects.

## Consequences

- Nothing is installed on the creator's PC; works in OBS, Streamlabs Desktop and any browser source.
- A leaked URL lets someone watch the widget, nothing more; rotation fixes it.
- Tokens are bearer secrets in URLs, so overlay requests must never be logged with their path.

## Alternatives considered

- OBS plugin or desktop app: per-OS builds and much more trust asked of creators.
- Signed short-lived URLs: OBS keeps URLs for months; rotation on demand fits better.
