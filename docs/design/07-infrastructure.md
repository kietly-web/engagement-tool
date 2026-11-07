# 07 Infrastructure

## Environments

| Env | Where | Data | Google sign-in | YouTube |
| --- | --- | --- | --- | --- |
| Local | `pnpm dev` (`wrangler dev` + Vite), PGlite or a local Postgres | Synthetic only | Dev stub | `FakeChatSource` |
| Preview | Workers Builds preview URL per branch | Synthetic only, separate Supabase project or none | Dev stub | `FakeChatSource` |
| Production | `*.workers.dev` (custom domain later, ADR needed) | Real | Google OAuth client | Real, read-only |

Production secrets exist only in the production Worker's secret store. Preview and local never hold them (non-negotiable 8).

## Free limits we design against

Figures as published at kickoff; re-check in the console when a slice adds load. All of these stop or error at the limit; none bill (ADR-005).

| Service | Limit | Our beta use (5–20 creators) |
| --- | --- | --- |
| Workers free | 100,000 requests/day; 10 ms CPU per invocation | Dashboard + overlay loads: low thousands/day |
| Durable Objects free (SQLite-backed) | 100,000 requests/day; 13,000 GB-s duration/day; 5 GB storage | One poll every ~5 s ≈ 720 requests per stream-hour; awake ~450 GB-s per stream-hour → ~25 stream-hours/day |
| Workers Builds | 3,000 build minutes/month | ~2 min per build |
| Cron Triggers | A few per account on free | 1 daily job (retention, refresh, keep-alive) |
| Supabase free | 500 MB database, 5 GB egress/month, pauses after ~7 days idle | Tiny rows; daily cron keeps it awake |
| YouTube Data API | 10,000 units/day per Google Cloud project | **The binding limit.** Assumption to measure in ET-6 (Q-T1): ~5 units per `liveChatMessages.list` call at a ~5 s interval ≈ 3,600 units per stream-hour → under 3 stream-hours/day for all creators combined |
| GitHub Actions | Free for public repositories | CI per push |

Consequence: until a quota extension is granted, the beta supports only a few streams a day. The quota ledger divides the daily budget among workspaces and stops sessions cleanly (R1, FR-11).

## Configuration

Worker `vars` (in `wrangler.jsonc`) hold only non-secret values. Secrets are set with `wrangler secret put` and listed in [SETUP.md](../SETUP.md) section 2. `VITE_*` values are public and must not hold secrets (checked in CI).

## CI/CD

- GitHub Actions: lint, typecheck, test, build, dependency audit, secret scan (gitleaks), code scan (Semgrep), PR description check. Actions pinned by SHA.
- Deploy: Cloudflare Workers Builds deploys `main` to production and each branch to a preview URL.
- Migrations: run by the owner (or a manual, protected workflow) as the owner role before deploying code that needs them; expand, deploy, contract.
- Smoke test: `.github/workflows/smoke.yml` checks key URLs and security headers on a schedule and on demand once `PRODUCTION_URL` is set.

## Cron

Daily at 03:00 Asia/Ho_Chi_Minh (20:00 UTC): delete ended-season viewer rows and stale YouTube data (ADR-006), process pending disconnect deletions (FR-09), touch the database to avoid free-plan pausing, write a heartbeat row the smoke test checks.

## Observability

Workers Logs (free tier) with request paths for `/o/*` redacted, no request bodies, no chat text. Errors carry route, workspace ID and error code only. Uptime and header checks through the smoke workflow; failed runs email the owner via GitHub notifications.
