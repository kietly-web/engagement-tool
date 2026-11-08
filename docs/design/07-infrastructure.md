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
| Hyperdrive (caching disabled) | 100,000 queries/day | ~4–6 queries per transaction (`BEGIN`, `SET ROLE`, settings, work, `COMMIT`); points flush in batches, so beta use is a few thousand a day |
| YouTube Data API | 10,000 units/day per Google Cloud project; `streamList` and `list` both 5 units per call | `streamList`: 5 units per connection, so tens of units per stream-hour (measured in ET-6, Q-T1). Polling fallback: ~3,600 units per stream-hour, under 3 stream-hours/day for everyone combined |
| GitHub Actions | Free for public repositories | CI per push |

ET-6 load (offline estimate, corrected in review). Demo mode ticks every 2 s: about 1,800 Durable Object requests and up to 5,400 row writes per demo-hour (session, poll and alarm on each tick). The object stays resident at about 460 GB-s per hour, so demos and live streams together share about 28 DO-hours a day. Each workspace therefore gets 4 demo starts a day (15 minutes each, `DEMO_STARTS_DAILY`), counted in `QuotaKeeper`. The polling reader ticks at YouTube's `pollingIntervalMillis` (about 5 s): about 720 LiveSession plus 720 QuotaKeeper requests per stream-hour. A 3,000-unit workspace budget allows about 50 minutes of polling a day until `streamList` lands.

Consequence: with `streamList` the beta is bounded by Durable Object duration (~28 stream-hours/day), which is ample for 5–20 creators. If ET-6 finds streaming unusable, quota becomes the limit again (a few streams a day) and the quota extension moves up to P1. The quota ledger divides the daily budget among workspaces and stops sessions cleanly either way (R1, FR-11).

## Configuration

Worker `vars` (in `wrangler.jsonc`) hold only non-secret values. Secrets are set with `wrangler secret put` and listed in [SETUP.md](../SETUP.md) section 2. `VITE_*` values are public and must not hold secrets (checked in CI).

## CI/CD

- GitHub Actions: lint, typecheck, test, build, dependency audit, secret scan (gitleaks), code scan (Semgrep), PR description check. Actions pinned by SHA.
- Deploy: Cloudflare Workers Builds deploys `main` to production and each branch to a preview URL.
- Migrations: run by the owner (or a manual, protected workflow) as the owner role before deploying code that needs them; expand, deploy, contract.
- Smoke test: `.github/workflows/smoke.yml` checks key URLs and security headers on a schedule and on demand once `PRODUCTION_URL` is set.

## Cron

Daily at 03:00 Asia/Ho_Chi_Minh (20:00 UTC): delete ended-season viewer rows and stale YouTube data (ADR-006), process pending disconnect deletions (FR-09), write a heartbeat row the smoke test checks.

## Observability

Workers Logs (free tier) with request paths for `/o/*` redacted, no request bodies, no chat text. Errors carry route, workspace ID and error code only. Uptime and header checks through the smoke workflow; failed runs email the owner via GitHub notifications.
