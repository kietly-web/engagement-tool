# 07 Infrastructure

## Environments

| Env | Where | Data | Google sign-in | YouTube |
| --- | --- | --- | --- | --- |
| Local | `pnpm dev` (`wrangler dev` + Vite), PGlite or a local Postgres | Synthetic only | Dev stub | `FakeChatSource` |
| Preview | Workers Builds preview URL per branch | Synthetic only, a Neon branch or none | Dev stub | `FakeChatSource` |
| Production | `*.workers.dev` (custom domain later, ADR needed) | Real | Google OAuth client | Real, read-only |

Production secrets exist only in the production Worker's secret store. Preview and local never hold them (non-negotiable 8).

## Free limits we design against

Figures as published at kickoff; re-check in the console when a slice adds load. All of these stop or error at the limit; none bill (ADR-005).

| Service | Limit | Our beta use (5–20 creators) |
| --- | --- | --- |
| Workers free | 100,000 requests/day; 10 ms CPU per invocation | Dashboard + overlay loads: low thousands/day |
| Durable Objects free (SQLite-backed) | 100,000 requests/day (incoming WebSocket messages count 20:1); 13,000 GB-s duration/day; 100,000 rows written/day; 5 GB storage | A streaming session keeps its DO awake: 128 MB × 3,600 s ≈ 460 GB-s per stream-hour → **about 28 stream-hours/day, the tightest limit with streaming**. Batch row writes (flush every ~10 s, not per message) |
| Workers Builds | 3,000 build minutes/month | ~2 min per build |
| Cron Triggers | 5 per account | 1 daily job (retention, refresh, heartbeat) |
| Neon free | 1 GB storage, 100 CU-hours/month (~400 h at 0.25 CU), 5 GB transfer, scale to zero after 5 min, never paused, 6 h point-in-time restore | Tiny rows; compute active only during streams and dashboard use |
| Hyperdrive (caching disabled) | 100,000 queries/day | About 2,900 per stream-hour from points flushes plus a few per API call: about 34 stream-hours a day |
| YouTube Data API | 10,000 units/day per Google Cloud project; `streamList` and `list` both 5 units per call | `streamList`: 5 units per connection, so tens of units per stream-hour (measured in ET-6, Q-T1). Polling fallback: ~3,600 units per stream-hour, under 3 stream-hours/day for everyone combined |
| GitHub Actions | Free for public repositories | CI per push |

ET-6 load (offline estimate, corrected in review). Demo mode ticks every 2 s: about 1,800 Durable Object requests and up to 5,400 row writes per demo-hour (session, poll and alarm on each tick). The object stays resident at about 460 GB-s per hour, so demos and live streams together share about 28 DO-hours a day. Each workspace therefore gets 4 demo starts a day (15 minutes each, `DEMO_STARTS_DAILY`), counted in `QuotaKeeper`. The polling reader ticks at YouTube's `pollingIntervalMillis` (about 5 s): about 720 LiveSession plus 720 QuotaKeeper requests per stream-hour. A 3,000-unit workspace budget allows about 50 minutes of polling a day until `streamList` lands.

ET-7: each overlay page load or WebSocket connect costs one Postgres lookup. Valid sockets stay connected, and unknown tokens are cached as misses for 5 minutes per isolate. A rotated link stops reconnecting, and a dead one retries only every 10 minutes after 8 failures, so a forgotten OBS source can't keep Neon's compute awake. Client frames close the socket, so a leaked link can't burn Durable Object requests by sending.

Consequence: with `streamList` the beta is bounded by Durable Object duration (~28 stream-hours/day), which is ample for 5–20 creators. If ET-6 finds streaming unusable, quota becomes the limit again (a few streams a day) and the quota extension moves up to P1. The quota ledger divides the daily budget among workspaces and stops sessions cleanly either way (R1, FR-11).

## Configuration

Worker `vars` (in `wrangler.jsonc`) hold only non-secret values. Secrets are set with `wrangler secret put` and listed in [SETUP.md](../SETUP.md) section 2. `VITE_*` values are public and must not hold secrets (checked in CI).

## CI/CD

- GitHub Actions: lint, typecheck, test, build, dependency audit, secret scan (gitleaks), code scan (Semgrep), PR description check. Actions pinned by SHA.
- Deploy: Cloudflare Workers Builds deploys `main` to production and each branch to a preview URL.
- Migrations: run by the owner (or a manual, protected workflow) as the owner role before deploying code that needs them; expand, deploy, contract.
- Smoke test: `.github/workflows/smoke.yml` checks key URLs and security headers on a schedule and on demand once `PRODUCTION_URL` is set.

## Cron

Every 6 hours (`0 */6 * * *` in `wrangler.jsonc`), `app.daily_maintenance()` deletes ended-season viewer rows and batch markers, idle sessions and orphan members, and writes the heartbeat row (ADR-006). A failure logs `daily_maintenance_failed`. Still to come: refresh-or-delete for channel metadata older than 30 days, and a queue of pending revocations (SETUP §3).

ET-8 load (corrected in review): a points flush is one Hyperdrive transaction of about 8 queries (role, settings, batch marker, upsert, top 10, commit), at most every 10 s per live session. That's about 2,900 queries per stream-hour, so the 100,000-query daily limit allows about 34 stream-hours, more than the Durable Objects' 28.

Correction (ET-20): a flush every 10 s also keeps Neon's compute awake for the whole stream. 100 CU-hours a month is about 400 hours at 0.25 CU, roughly 13 stream-hours a day on average (overlapping streams share the same awake time). Until ET-21 lengthens the flush interval, Neon compute is the tightest limit, not Durable Object duration.

## Observability

Workers Logs (free tier) with request paths for `/o/*` redacted, no request bodies, no chat text. Errors carry route, workspace ID and error code only. Uptime and header checks through the smoke workflow; failed runs email the owner via GitHub notifications.
