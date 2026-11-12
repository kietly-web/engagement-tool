# Setup and open work register

Everything **not done yet**. Pick an item, do it, tick it with the date in the same PR. Add a row whenever you leave something unfinished. Never write secret values here.

Last updated: 10/11/2026.

## 0. Security fixes on existing configuration

| Done | Step | Where | Who |
| --- | --- | --- | --- |
| [ ] | Protect `main`: require PR, require status checks `lint, typecheck, test, build`, `dependency audit`, `secret scan`, `code scan`, `what-changed`; block force-push and deletion. Do it once ET-2 is merged (CI now runs every job) | GitHub → repo → Settings → Rules → Rulesets → New branch ruleset | Owner |
| [ ] | Turn on Dependabot alerts, secret scanning and push protection | GitHub → repo → Settings → Advanced Security | Owner |

## 1. Configuration not done yet

P0: production doesn't work without it. P1: a feature or workflow is degraded. P2: needed before the first real user.

| Done | Pri | Setting | Where | How / value | Unlocks | Who |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | P0 | Cloudflare account, **no payment method** | dash.cloudflare.com → Sign up | Free plan only; then run `npx wrangler login` so Claude can deploy previews | ET-2 deploy | Owner |
| [ ] | P0 | Connect repo to Workers Builds | Cloudflare → Workers & Pages → Create → Import a repository → `kietly-web/engagement-tool` | Project name `engagement-tool`; root directory `/`; build command `pnpm build`; deploy command `pnpm --filter @et/worker exec wrangler deploy`; non-production branch deploy command `pnpm --filter @et/worker exec wrangler versions upload`; production branch `main` | Production deploy of ET-2 | Owner |
| [ ] | P0 | Neon account (Free, no card) and project in **Singapore** | console.neon.tech → New project → Region AWS Asia Pacific (Singapore) | Postgres 17; keep the owner connection string in a password manager, never in the repo | ET-4 | Owner |
| [ ] | P0 | Apply migrations | Owner's machine | `DATABASE_OWNER_URL='<owner connection string, direct (not pooled)>' pnpm --filter @et/db migrate`; prints `Applied: 0001_tenancy.sql` | ET-5 | Owner (or Claude once `neonctl`/Neon MCP is authorised) |
| [ ] | P0 | Worker login role `app_worker` | Neon Console → SQL Editor, as the owner | `CREATE ROLE app_worker LOGIN PASSWORD '<openssl rand -base64 32>' IN ROLE app_runtime;` then check `SELECT rolbypassrls, rolsuper, pg_has_role('app_worker', 'neon_superuser', 'MEMBER') FROM pg_roles WHERE rolname = 'app_worker';` returns `f, f, f`. Use SQL, not the console's Roles page (that adds `neon_superuser`) | ET-5 | Owner |
| [ ] | P0 | Hyperdrive config, **caching disabled** | `npx wrangler hyperdrive create engagement-tool-db --connection-string="postgres://app_worker:<password>@<neon-host>/neondb?sslmode=require" --caching-disabled` | Send Claude the printed ID (not secret) to add as `"hyperdrive": [{ "binding": "HYPERDRIVE", "id": "…" }]` in `apps/worker/wrangler.jsonc`. Until then the API answers 503 `not_configured`. The password stays inside Hyperdrive | ET-5 | Owner |
| [ ] | P0 | Google Cloud project, **no billing account** | console.cloud.google.com → New project | Then APIs & Services → Library → enable "YouTube Data API v3" | ET-5 | Owner |
| [ ] | P0 | OAuth consent screen | Google Auth Platform → Branding / Audience / Data access | External; Testing; add beta creators and mods as test users; scopes `openid`, `email`, `profile`, `youtube.readonly` | ET-5 | Owner |
| [ ] | P0 | OAuth web client | Google Auth Platform → Clients → Create → Web application | Authorised redirect URIs: `https://<worker>.workers.dev/api/auth/google/callback` and `http://localhost:8787/api/auth/google/callback` (local testing). Send Claude the client ID (not secret) to add as `GOOGLE_CLIENT_ID` in `wrangler.jsonc` vars | ET-5 verification | Owner |
| [ ] | P0 | `GOOGLE_CLIENT_SECRET` (Secret) | `wrangler secret put GOOGLE_CLIENT_SECRET` | From the OAuth client above | ET-5 | Owner |
| [ ] | P0 | `TOKEN_ENCRYPTION_KEY` (Secret) | `wrangler secret put TOKEN_ENCRYPTION_KEY` | `openssl rand -base64 32` | ET-5 | Owner |
| [ ] | P0 | `SESSION_SECRET` (Secret) | `wrangler secret put SESSION_SECRET` | `openssl rand -base64 32` | ET-5 | Owner |
| [ ] | P1 | `PRODUCTION_URL` (repo variable, not secret) | GitHub → Settings → Secrets and variables → Actions → Variables | `https://<worker>.workers.dev` | Smoke test | Owner |
| [ ] | P2 | Accept Cloudflare and Neon DPAs | Each dashboard's legal/DPA page | Record the date in `docs/design/03-security-privacy.md` | Launch | Owner |

## 2. Environment variable reference

| Name | Required | Where | Secret | Used by |
| --- | --- | --- | --- | --- |
| `HYPERDRIVE` | Yes | `wrangler.jsonc` binding (ID only) | No (credentials live in Hyperdrive) | `packages/db` via `apps/worker` |
| `DATABASE_OWNER_URL` | Migrations only | Owner's shell, never stored | Yes | `pnpm --filter @et/db migrate` |
| `GOOGLE_CLIENT_ID` | Yes | `wrangler.jsonc` vars | No | `apps/worker` auth |
| `GOOGLE_CLIENT_SECRET` | Yes | Worker secret | Yes | `apps/worker` auth |
| `TOKEN_ENCRYPTION_KEY` | Yes | Worker secret | Yes | Refresh-token encryption |
| `SESSION_SECRET` | Yes | Worker secret | Yes | Session ID hashing |
| `PRODUCTION_URL` | For smoke | GitHub Actions variable | No | `.github/workflows/smoke.yml` |

## 3. Known gaps (built, with a limitation)

| Done | Gap | Fix | Where |
| --- | --- | --- | --- |
| [x] 08/11/2026 | CI skips Node jobs while there's no `package.json` | Removed the `detect` job in ET-2 | `.github/workflows/ci.yml` |
| [x] 08/11/2026 | Smoke test paths are placeholders until the app exists | ET-2 serves `/` and `/healthz` | `.github/workflows/smoke.yml` |
| [ ] | `Poll.close()` returns voter channel IDs for points | ET-8 uses them server-side only; never in overlay payloads or logs (ET-3 review note) | `apps/worker` LiveSession |
| [x] 08/11/2026 | ET-4 review note: call `app.upsert_member` only after ID-token verification | Done in ET-5 (`auth.ts` callback) | `apps/worker` |
| [ ] | Production check that `SET LOCAL ROLE app_runtime` works through Hyperdrive (`current_user` is `app_runtime` inside a transaction) | Run once by hand after setup; automate in the smoke test when `/healthz` gains a DB probe | Smoke test |
| [ ] | If Google's revoke endpoint is down, disconnect and account deletion return 502 and rely on the user retrying | Queue a pending revoke-and-delete for the daily cron, so the 7-day promise (NN3) holds without a retry (ET-8 cron) | `apps/worker`, `packages/db` |
| [ ] | Token encryption key rotation not built | Ciphertexts carry a version byte; add `TOKEN_ENCRYPTION_KEY_V2` handling and a re-encrypt job when a rotation is needed | `apps/worker/src/crypto.ts` |
| [ ] | Chat is read by polling `liveChatMessages.list` (about 3,600 units per stream-hour), so a workspace gets about 50 live minutes a day | ET-6 spike: implement and verify `streamList` (ADR-004) against a real stream; then raise the per-workspace budget | `packages/youtube`, `apps/worker/src/live` |
| [ ] | `LiveSession`/`QuotaKeeper` adapters only boot-checked with `wrangler dev`; the engine and routes are tested in Node with in-memory storage | First real run after owner setup: start a demo session, then a YouTube session | `apps/worker/src/live/durable.ts` |
| [ ] | A visible dashboard keeps Neon's compute awake for the whole stream (each 5 s poll = 2 Postgres transactions + 2 DO calls); fine for a small beta (~200 of 400 compute-hours a month) | Cache membership in the session's Durable Object or use a session-authenticated WebSocket before the beta grows | `apps/web`, `apps/worker` |
| [ ] | Points flush every 10 s keeps Neon's compute awake for the whole stream; 100 CU-hours a month is about 400 hours, roughly 13 stream-hours a day on average, tighter than the Durable Object limit | ET-21: flush about every 10 minutes and at stop, live leaderboard from session memory | `apps/worker/src/live/engine.ts` |
| [ ] | Overlay WebSocket path only boot-checked (`WebSocketPair`, hibernation) — Node tests stub the DO | First real run: add a poll overlay to OBS during a demo session | `apps/worker/src/live/durable.ts` |
| [ ] | Demo starts capped at 4 per workspace per day (`DEMO_STARTS_DAILY`) to protect shared Durable Object time | Raise once real usage is known | `apps/worker/wrangler.jsonc` |
| [ ] | No edge rate limit on `/o/*` (scanners, stale OBS sources) | Cloudflare dashboard → Security → WAF → Rate limiting rules (free plan allows one): path starts with `/o/`, 30 requests per 10 s per IP, block 10 s. The Worker already caches misses for 5 minutes per isolate | Owner, after the domain is set up |
| [x] 08/11/2026 | Overlay link rotation isn't in an audit log | ET-9 logs `overlay_rotated` | `apps/worker/src/overlay.ts` |
| [ ] | Invite email matching uses the email stored at the member's last sign-in; Gmail dot and `+tag` variants don't match | Acceptable for the beta; require a sign-in in the last hour before accepting if abuse appears | `packages/db` `accept_invite` |
| [ ] | `/overlay/*` CSP override (`!` detach in `_headers`) only checked with `wrangler dev` | After the first deploy: `curl -sI https://<worker>/overlay/?preview=poll` must show exactly one `Content-Security-Policy` with `frame-ancestors 'self'`; if two, the dashboard preview goes blank (fails safe) | ET-15 |
| [ ] | Membership milestone messages (`memberMilestoneChatEvent`) aren't shown | Add as a donation kind if creators want it | `packages/youtube/src/live-chat.ts` |
| [ ] | Donation alerts verified only on synthetic events | ET-15: a friend sends a small Super Chat on the Unlisted test stream | ET-15 |
| [ ] | No rate limit on sign-in and session lookups | Add Workers Rate Limiting binding (free plan) or a per-IP Durable Object counter before open sign-up | `apps/worker` |
| [x] 08/11/2026 | Audit log not built | ET-9: invites, membership, overlay rotation, disconnect, viewer erasure, seasons. Account deletion deletes the workspace and its log with it | `packages/db`, `apps/worker` |
| [ ] | Preview deployments can't sign in (Google needs exact redirect URIs) | Dev-only sign-in stub compiled out of production, if previews need it | `apps/worker` |
| [ ] | `channels.list` (1 unit per creator sign-in) isn't counted by the quota ledger | Route sign-in's channel lookup through `QuotaKeeper` | `apps/worker/src/auth.ts` |
| [ ] | Dashboard tested by unit and route tests only; not yet clicked through against real Google | First run after owner setup | `apps/web` |
| [x] 08/11/2026 | Invites need a definer function | ET-9 `accept_invite()` checks the verified email; still no `INSERT` on `workspace_member` for `app_runtime` | `packages/db` |
| [ ] | Tests can't prove `app_worker` is unable to `SET ROLE app_definer` (PGlite ignores login users) | Postgres 16+ rules forbid it; add a real-Postgres CI job if a paid-free option appears, or check once by hand on Neon | CI |
| [ ] | Cron heartbeat isn't monitored | The cron writes `app.maintenance_heartbeat` (ET-8); `/healthz` should read `app.maintenance_last_run()` and return 503 when it's over 36 h old, so the smoke test alerts | `apps/worker`, runbook |
| [ ] | Channel metadata (`channel_title`) isn't refreshed or deleted after 30 days (NN3) | Daily cron: refresh via `channels.list` with the stored token, or delete the connection | `apps/worker/src/maintenance.ts` |
| [ ] | Ending a season leaves its viewer rows until the next retention run (up to 6 h) | Seasons are capped at 29 days, so the total stays under 30 (NN3); delete straight away if counsel prefers | `packages/db` |

## 4. Remaining backlog

Next slices in order: ET-13, ET-14, ET-17, ET-21, ET-15, ET-22; then ET-19, ET-10, ET-16, ET-18, ET-11. Details in [design/08-delivery-plan.md](design/08-delivery-plan.md).

## 5. Open questions

| Done | Question | Who | Detail |
| --- | --- | --- | --- |
| [ ] | Q-L1 Lawful basis and controller/processor role for viewer channel IDs | Counsel | Before open sign-up |
| [ ] | Q-L2 Cross-border transfer paperwork for Singapore storage | Counsel | Before open sign-up |
| [ ] | Q-L3 Seasons longer than 30 days | Counsel / YouTube policy | Until answered, seasons ≤ 30 days |
| [ ] | Q-L4 Data localisation | Counsel | Storage is movable (ADR-002) |
| [ ] | Q-D1 Viewer request channel and deadline | Owner | Needed by ET-11 |
| [ ] | Q-T1 Does `streamList` work with `youtube.readonly` from a Durable Object, and what does a stream-hour cost? | ET-6 | Spike first |
| [x] 08/11/2026 | Q-T2 Hyperdrive vs Neon serverless driver | ET-4 | Hyperdrive + `pg`, caching disabled (ADR-002) |
| [ ] | Q-T3 Concurrent sessions on DO free plan | ET-6 | Estimate |
| [ ] | Q-P1 Show `!points` on an overlay ticker? | Owner | Product |
| [ ] | Q-P2 Product name and domain | Owner | Strictly $0 confirmed 10/11/2026, so no domain. Google app verification is likely to need one, which may block public sign-up (ET-11); the invited beta is unaffected. A domain needs an ADR (cost) |
| [x] 10/11/2026 | Q-P3 What "donation items" means | Owner | YouTube Super Chats first, VN donation services later, never handling money (ADR-008) |
| [ ] | Q-T4 Which VN donation services have usable webhooks/APIs and which creators use | Claude + owner | Blocks FR-16 (ET-19) |

## 6. Future enhancements

| Idea | Why | Notes |
| --- | --- | --- |
| English UI | Second audience | Catalogs ready from ET-2 |
| Twitch `ChatSource` | More creators | New ADR and sub-processor row |
| Optional bot that posts creator-written text | Viewers see results in chat | Needs a broader scope; ADR replacing ADR-004 |
| AI poll suggestions or stream recaps | Creator convenience | ADR; "AI writes words, code computes numbers" |
| Custom domain | Branding | About $10/year; ADR (ADR-005) |

## 7. Launch readiness (before the first real user)

All are P2 unless marked.

| Done | Item | Why (law / risk / ID) | Where |
| --- | --- | --- | --- |
| [ ] | Data inventory complete and reviewed | PDPL | [compliance/data-inventory.md](compliance/data-inventory.md) |
| [ ] | Privacy notice published in Vietnamese (draft for counsel), linking Google's privacy policy and YouTube Terms | PDPL; YouTube API Terms | `/privacy` (ET-11) |
| [ ] | Terms of service published, stating points have no value | Consumer law; R8 | `/terms` (ET-11) |
| [ ] | Rights requests work end to end: creator export/delete, viewer erase by channel ID | PDPL; FR-09, FR-12 | Dashboard settings |
| [ ] | Cross-border transfer and impact assessment, if counsel says required | PDPL, Decree 356; Q-L2 | `docs/compliance/` |
| [ ] | Sub-processor agreements (DPAs) accepted for every service | PDPL | `docs/design/03-security-privacy.md` |
| [ ] | Google OAuth app verification submitted (before more than 100 users or leaving Testing) | R4 | Google Auth Platform |
| [ ] | YouTube API quota extension and compliance audit (before open sign-up) | R1; YouTube API Terms | Google Cloud → YouTube API → Quotas |
| [ ] | Backups on and one restore tested | Data loss | [runbooks/operations.md](runbooks/operations.md) |
| [ ] | Error alerts and uptime alerts reach a person | Silent outage; R6 | [runbooks/operations.md](runbooks/operations.md) |
| [ ] | Breach runbook confirmed by counsel (deadlines, contacts) | PDPL | [runbooks/operations.md](runbooks/operations.md) |
| [ ] | Production security headers pass the smoke test | Web attacks | `.github/workflows/smoke.yml` |
