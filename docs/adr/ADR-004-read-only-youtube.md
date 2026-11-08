# ADR-004 Read-only YouTube integration through a ChatSource interface

Status: Accepted · 2026-11-08

## Context

The owner chose read-only (no chat bot, no moderation). Writing would need broader scopes, cost about 50 quota units per message and could harm a creator's channel. Quota is the scarcest resource (R1): the default is 10,000 units/day per Google Cloud project, and both `liveChatMessages.list` and `liveChatMessages.streamList` cost 5 units per call. Polling `list` every ~5 s costs about 3,600 units per stream-hour; `streamList` keeps one server-streaming connection open and costs 5 units per connection. App verification is easier with a smaller scope (R4).

## Decision

- Only `youtube.readonly` is requested. `packages/youtube` is the only code that calls YouTube, and it exposes a `ChatSource` interface with read methods only: find the active broadcast and its live chat ID, then deliver messages.
- The primary reader is `streamList` over HTTP, held open by the `LiveSession` Durable Object. On disconnect it reconnects with the last `nextPageToken`, with backoff, and a one-minute alarm watchdog restarts a stalled stream. If `streamList` is unavailable for the scope or runtime, it falls back to polling `list`, honouring `pollingIntervalMillis` and never faster.
- `packages/youtube` owns quota accounting: units are counted per call per workspace per Pacific-time day (YouTube's quota day), a per-workspace budget is enforced, and a session stops with a stated reason before the project limit.
- Messages are passed to `packages/core` as `{ channelId, displayName, text, publishedAt }` and never persisted. `FakeChatSource` generates synthetic chat for tests and demos.

## Consequences

- With streaming, a stream-hour should cost tens of units instead of thousands, so the default quota covers well over 100 stream-hours a day. Durable Object duration then becomes the tighter free limit (`07-infrastructure.md`). ET-6 starts with a spike that proves `streamList` works with `youtube.readonly` from a Durable Object, and measures cost and reconnect frequency (Q-T1).
- Results reach viewers only through overlays and the stream itself (ADR-007).
- A quota extension (free, needs a compliance audit) stays a launch-readiness item, but is no longer urgent for the beta.
- Adding Twitch later means another `ChatSource`, not changes to `core`.

## Alternatives considered

- Polling `list` only: simple and documented, but uses the daily quota in under 3 stream-hours. Kept as the fallback.
- Bot that posts results in chat: broader scope, quota cost, risk to channels; owner declined.
- Scraping the public chat page: against YouTube terms.
