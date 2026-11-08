# ADR-006 Viewer data minimisation and 30-day seasons

Status: Accepted · 2026-11-08

## Context

Viewers may be children (R3); VN PDPL treats children's data strictly, and the lawful basis for viewer data is still open (Q-L1). YouTube policy limits how long API data is kept (R2). Loyalty points need some per-viewer state (FR-06).

## Decision

- Per viewer we store only the YouTube channel ID and per-workspace, per-season counters (points, votes cast, games played). No message text, avatars, profile data or cross-workspace linking.
- Display names live only in the `LiveSession` Durable Object's memory for the session and are dropped when it ends. Leaderboards shown after a session show ranks and points with names only if the viewer appears in the current live session.
- Points run in seasons of at most 30 days. A daily cron deletes viewer rows from seasons that ended, and anything from the YouTube API older than 30 days that wasn't refreshed.
- Chat text is processed in memory and never logged, including in error reports.
- Creators can erase one viewer by channel ID (FR-12).

## Consequences

- No all-time leaderboards until Q-L3 is answered.
- Rights requests are simple: there is almost nothing to export.
- Logs and tests must prove no chat text is stored (reviewer checks this).

## Alternatives considered

- Nothing per viewer (aggregate only): lowest risk, but no loyalty points; owner chose minimal points.
- Full viewer profiles: highest risk with possible children; rejected.
