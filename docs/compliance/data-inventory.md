# Personal data inventory

Draft for counsel, not legal advice. One row per kind of personal data the product touches, including data it only passes through. Update in the same PR that adds, moves or stops collecting a field; `security-compliance-reviewer` checks this.

Last updated: 08/11/2026 (ET-8: viewer points and seasons).

| Data | Whose | Source | Purpose (FR / US) | Lawful basis or consent | Stored where (region) | Retention, then | Who can access | Sub-processors | Sensitive? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Google subject ID, email, name | Creator, moderator | Google sign-in | Sign-in, invites (FR-01, FR-02) | Contract (terms accepted at sign-up) | Postgres, Singapore | Account life, deleted at once on account deletion; people who never join a workspace are purged 30 days after their last sign-in | The person; the workspace owner sees members' emails, while moderators see names only (`app.workspace_members()`); operator | Neon, Cloudflare, Google | No |
| Google refresh token (encrypted) | Creator | Google OAuth | Read live chat (FR-03) | Contract + Google consent screen | Postgres, Singapore | Until disconnect; revoked at once and deleted | Worker only | Neon, Google | No (credential) |
| Google access token (short-lived) | Creator | Google token endpoint | Read live chat during a session | Contract + Google consent | LiveSession Durable Object memory only | Until it expires (about 1 hour) or the session stops | Worker only | Cloudflare, Google | No (credential) |
| Encrypted refresh token, session copy | Creator | Postgres (`youtube_connection`) | Let the session refresh access without a database read | Contract | LiveSession Durable Object storage | While the session is live; removed on stop | Worker only | Cloudflare | No (credential) |
| Session state (broadcast ID, live chat ID, page token, poll counts) | Creator (YouTube-derived) | YouTube API | Run the live session | Contract | LiveSession Durable Object storage | YouTube IDs and the page token removed when the session stops; everything purged on disconnect and account deletion | Worker only | Cloudflare | No |
| Channel ID and title | Creator | YouTube API | Find broadcasts (FR-03) | Contract | Postgres, Singapore | Refreshed at least every 30 days; deleted within 7 days of disconnect | Workspace members, operator | Neon, Google | No |
| Viewer YouTube channel ID + per-season counters | Viewer (possibly a child) | YouTube live chat | Points and leaderboard (FR-06) | **Open (Q-L1)** | Postgres `app.viewer_points` (Singapore); pending deltas in LiveSession storage, flushed about every 10 s and only while a season runs | Season ends at most 30 days after it starts; the daily cron (03:00 Vietnam time) deletes the rows of ended seasons, so at most about 24 h after the end; the owner can erase one viewer across all seasons at any time (FR-12) | Workspace members see ranks and points, never the raw ID on overlays; operator | Neon, Cloudflare, Google | Possibly children's data |
| Viewer's choice in an open poll (channel ID → option) | Viewer (possibly a child) | YouTube live chat (`!vote`) | One counted vote per viewer (FR-04) | **Open (Q-L1)** | Durable Object memory and storage only | Until the poll closes; `close()` clears it and keeps only counts | Nobody (server only) | Cloudflare | Possibly children's data |
| Viewer display name | Viewer | YouTube live chat | Show names on the leaderboard overlay during the stream | **Open (Q-L1)** | LiveSession memory only (at most 5,000 names, truncated to 40 characters); never in storage, Postgres or logs | Cleared when the session stops or the Durable Object is evicted | Overlay viewers (on stream), workspace members during the session | Cloudflare | Possibly children's data |
| Chat message text | Viewer | YouTube live chat | Parse commands (FR-04, FR-06, FR-07) | **Open (Q-L1)** | Not stored; in memory for one parse | Discarded immediately | Nobody | Cloudflare (in transit), Google | Possibly children's data |
| Session token (stored as HMAC) | Creator, moderator | Our server | Keep signed in | Contract | Postgres, Singapore | Unusable after 7 days idle or 30 days absolute; rows purged on every sign-in (daily cron from ET-8), on logout, on a new sign-in in the same browser, and on account deletion | Worker only | Neon | No |
| IP address, user agent | Creator, moderator, overlay host | Requests | Security, rate limiting | Legitimate interest (to confirm) | Cloudflare edge and Workers Logs | Workers Logs retention (days); not copied elsewhere | Operator | Cloudflare | No |
| Audit log entries | Creator, moderator | Our server | Accountability for membership, tokens, sessions, deletion | Legal obligation / legitimate interest | Postgres, Singapore | 12 months, then deleted | Workspace owner, operator | Neon | No |

## Never stored

| Data | Why not | Enforced by |
| --- | --- | --- |
| Chat message text | Non-negotiable 2; children | Core parses and drops; tests assert stored shape; reviewer |
| Viewer avatars, profile data, display names in Postgres | Non-negotiable 2 | Allowlisted viewer columns; reviewer |
| Google profile photo | Not needed (ADR-003) | Auth callback drops it |
| Overlay token plaintext | Bearer secret (ADR-007) | Stored hashed; `/o/*` paths not logged |

## Rights requests

Creators and moderators export (profile, memberships with join dates, session dates, connected channel; never tokens) or delete their data from the dashboard (ET-5). Viewers ask the creator, who erases by channel ID (FR-12), or contact us at the address in the privacy notice (Q-D1). Deadline per PDPL to be confirmed by counsel. Tested on: not yet (SETUP §7).
