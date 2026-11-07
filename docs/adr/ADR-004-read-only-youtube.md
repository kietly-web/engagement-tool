# ADR-004 Read-only YouTube integration through a ChatSource interface

Status: Accepted · 2026-11-08

## Context

The owner chose read-only (no chat bot, no moderation). Writing would need broader scopes, cost about 50 quota units per message and could harm a creator's channel. Quota is the scarcest resource (R1). App verification is easier with a smaller scope (R4).

## Decision

- Only `youtube.readonly` is requested. `packages/youtube` is the only code that calls YouTube, and it exposes a `ChatSource` interface with read methods only: find the active broadcast and its live chat ID, then page through messages.
- Polling honours the `pollingIntervalMillis` and `nextPageToken` YouTube returns, never faster.
- `packages/youtube` owns quota accounting: units are counted per call per workspace per Pacific-time day (YouTube's quota day), a per-workspace budget is enforced, and a session stops with a stated reason before the project limit.
- Messages are passed to `packages/core` as `{ channelId, displayName, text, publishedAt }` and never persisted. `FakeChatSource` generates synthetic chat for tests and demos.

## Consequences

- Results reach viewers only through overlays and the stream itself (ADR-007).
- Cost per stream-hour is measured in ET-6 (Q-T1); a quota extension request (free, needs a compliance audit) is a launch-readiness item.
- Adding Twitch later means another `ChatSource`, not changes to `core`.

## Alternatives considered

- Bot that posts results in chat: broader scope, quota cost, risk to channels; owner declined.
- Scraping the public chat page: against YouTube terms.
