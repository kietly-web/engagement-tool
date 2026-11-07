# Personal data inventory

Draft for counsel, not legal advice. One row per kind of personal data the product touches, including data it only passes through. Update in the same PR that adds, moves or stops collecting a field; `security-compliance-reviewer` checks this.

Last updated: 08/11/2026 (planned at kickoff; nothing is collected until ET-5).

| Data | Whose | Source | Purpose (FR / US) | Lawful basis or consent | Stored where (region) | Retention, then | Who can access | Sub-processors | Sensitive? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Google subject ID, email, name | Creator, moderator | Google sign-in | Sign-in, invites (FR-01, FR-02) | Contract (terms accepted at sign-up) | Postgres, Singapore | Account life; deleted within 30 days of account deletion | The person; workspace owner sees members' email and name; operator | Supabase, Cloudflare, Google | No |
| Google refresh token (encrypted) | Creator | Google OAuth | Read live chat (FR-03) | Contract + Google consent screen | Postgres, Singapore | Until disconnect; revoked at once and deleted | Worker only | Supabase, Google | No (credential) |
| Channel ID and title | Creator | YouTube API | Find broadcasts (FR-03) | Contract | Postgres, Singapore | Refreshed at least every 30 days; deleted within 7 days of disconnect | Workspace members, operator | Supabase, Google | No |
| Viewer YouTube channel ID + per-season counters | Viewer (possibly a child) | YouTube live chat | Points and leaderboard (FR-06) | **Open (Q-L1)** | Postgres, Singapore; live copy in Durable Object storage | End of season (≤ 30 days), then deleted by the daily cron; erasable on request (FR-12) | Workspace members see ranks and points, never the raw ID on overlays; operator | Supabase, Cloudflare, Google | Possibly children's data |
| Viewer display name | Viewer | YouTube live chat | Show names on overlays during the stream | **Open (Q-L1)** | Durable Object memory only | Dropped when the session ends | Overlay viewers (on stream), workspace members during the session | Cloudflare | Possibly children's data |
| Chat message text | Viewer | YouTube live chat | Parse commands (FR-04, FR-06, FR-07) | **Open (Q-L1)** | Not stored; in memory for one parse | Discarded immediately | Nobody | Cloudflare (in transit), Google | Possibly children's data |
| Session cookie ID (hashed) | Creator, moderator | Our server | Keep signed in | Contract | Postgres, Singapore | 7 days idle | Worker only | Supabase | No |
| IP address, user agent | Creator, moderator, overlay host | Requests | Security, rate limiting | Legitimate interest (to confirm) | Cloudflare edge and Workers Logs | Workers Logs retention (days); not copied elsewhere | Operator | Cloudflare | No |
| Audit log entries | Creator, moderator | Our server | Accountability for membership, tokens, sessions, deletion | Legal obligation / legitimate interest | Postgres, Singapore | 12 months, then deleted | Workspace owner, operator | Supabase | No |

## Never stored

| Data | Why not | Enforced by |
| --- | --- | --- |
| Chat message text | Non-negotiable 2; children | Core parses and drops; tests assert stored shape; reviewer |
| Viewer avatars, profile data, display names in Postgres | Non-negotiable 2 | Allowlisted viewer columns; reviewer |
| Google profile photo | Not needed (ADR-003) | Auth callback drops it |
| Overlay token plaintext | Bearer secret (ADR-007) | Stored hashed; `/o/*` paths not logged |

## Rights requests

Creators and moderators export or delete their data from settings (ET-5, ET-11). Viewers ask the creator, who erases by channel ID (FR-12), or contact us at the address in the privacy notice (Q-D1). Deadline per PDPL to be confirmed by counsel. Tested on: not yet (SETUP §7).
