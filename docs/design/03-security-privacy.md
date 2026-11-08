# 03 Security and privacy

Draft for counsel where it touches law; not legal advice. Non-negotiables are in `CLAUDE.md`; data fields in [data-inventory.md](../compliance/data-inventory.md).

## Assets

Creator Google refresh tokens; workspace membership and roles; viewer channel IDs with counters; overlay tokens; session cookies; Worker secrets; the creators' live streams themselves (what appears on screen).

## Threat model

| ID | Threat | Control | Verified by |
| --- | --- | --- | --- |
| T1 | A member reads or changes another workspace's rows | Forced RLS, `app_runtime` without bypass, transaction-local workspace context | PGlite isolation tests for every workspace table |
| T2 | Moderator exceeds role (rotates tokens, invites, deletes workspace) | Role checked in route and in RLS policies | Role matrix tests |
| T3 | Client steers a request to another workspace's Durable Object | DO IDs derived server-side from membership; never accepted from the client | Route tests; reviewer |
| T4 | Hostile chat text on stream (HTML, scripts, bidi overrides, zalgo, huge names) | `textContent` only; strip control/bidi chars; cap lengths; strict CSP | Adversarial core and overlay tests |
| T5 | Leaked overlay URL | Read-only socket, hashed per-widget tokens, rotation closes sockets, no paths in logs | US-07 test |
| T6 | Stolen refresh tokens from a DB leak | AES-GCM encryption with a Worker secret; revoke on disconnect | Unit test; reviewer |
| T7 | Session theft or CSRF on dashboard | `__Host-` cookie, `HttpOnly`, `SameSite=Lax`, Origin check, hashed session IDs | Route tests |
| T8 | Quota exhaustion by spam or many sessions | Per-workspace budget; one session per workspace; core parses cheaply and ignores non-commands | Quota ledger tests |
| T9 | Secret reaches the browser | Secrets only from Worker `env`; `VITE_*` is public; CI name check | `scripts/check-public-env.sh` |
| T10 | Over-collection of children's data | Allowlisted viewer fields; no text in storage or logs | Reviewer; tests assert stored shape |
| T11 | Retention not enforced (cron down, database compute suspended at its monthly limit) | Daily cron with alert on failure; deletion is idempotent | Runbook; cron test |
| T12 | Supply chain (malicious package or Action) | Lockfile, Dependabot, pinned Action SHAs, `pnpm audit`, minimum release age | CI |

## Controls checklist (ASVS L2 highlights)

- Authorisation on every API route, by role, before any work.
- Validation of every input with a schema at the route boundary.
- Security headers on every response: HSTS, CSP (`frame-ancestors 'none'` for the dashboard), `X-Content-Type-Options`, `Referrer-Policy`.
- Rate limits on sign-in and session start.
- Audit log (ET-9) of invites, membership, overlay link rotation, session start/stop, YouTube disconnect, viewer erasure and seasons, without viewer IDs, emails, tokens or chat text. Actor names are snapshotted so departed members stay identifiable.
- Errors returned to clients carry no internals; logs carry no personal data or tokens.

## Sub-processor register

| Service | Purpose | Data | Region | Plan | Terms / DPA |
| --- | --- | --- | --- | --- | --- |
| Cloudflare | Hosting, Durable Objects, request handling | All requests in transit; DO state including display names during a session | Global edge | Workers free | Cloudflare DPA (self-serve), to accept before launch |
| Neon | Postgres | Member accounts, encrypted tokens, viewer channel IDs + counters | Singapore (AWS) | Free | Neon DPA, to accept before launch |
| Google | Sign-in and YouTube Data API | Creator/mod identity; reads chat | Google | No billing | Google API Terms, YouTube API Services Terms |
| GitHub | Code and CI | No personal data (synthetic tests only) | US | Free | — |

## Data-subject rights

- Creators and moderators: export and delete from settings (built in ET-5 and ET-11); deadlines under PDPL confirmed by counsel.
- Viewers: request through the creator (who uses FR-12) or our contact address (Q-D1). There is no viewer profile to export beyond channel ID and counters.

## Breach timers

Recorded in [operations.md](../runbooks/operations.md). Notify the VN authority within the PDPL deadline (72 hours from awareness unless counsel advises otherwise) and affected creators without delay.
