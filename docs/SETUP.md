# Setup and open work register

Everything **not done yet**. Pick an item, do it, tick it with the date in the same PR. Add a row whenever you leave something unfinished. Never write secret values here.

Last updated: 08/11/2026.

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
| [ ] | P0 | Worker login role `app_worker` | Neon Console → SQL Editor, as the owner | `CREATE ROLE app_worker LOGIN PASSWORD '<openssl rand -base64 32>' IN ROLE app_runtime;` then check `SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'app_worker';` returns `f, f`. Use SQL, not the console's Roles page (that adds `neon_superuser`) | ET-5 | Owner |
| [ ] | P0 | Hyperdrive config, **caching disabled** | `npx wrangler hyperdrive create engagement-tool-db --connection-string="postgres://app_worker:<password>@<neon-host>/neondb?sslmode=require" --caching-disabled` | Put the printed ID in `apps/worker/wrangler.jsonc` as the `HYPERDRIVE` binding (ET-5 adds the block). The ID is not secret; the password stays inside Hyperdrive | ET-5 | Owner |
| [ ] | P0 | Google Cloud project, **no billing account** | console.cloud.google.com → New project | Then APIs & Services → Library → enable "YouTube Data API v3" | ET-5 | Owner |
| [ ] | P0 | OAuth consent screen | Google Auth Platform → Branding / Audience / Data access | External; Testing; add beta creators and mods as test users; scopes `openid`, `email`, `profile`, `youtube.readonly` | ET-5 | Owner |
| [ ] | P0 | OAuth web client | Google Auth Platform → Clients → Create → Web application | Redirect URI `https://<worker>.workers.dev/api/auth/google/callback`; client ID goes in `wrangler.jsonc` vars as `GOOGLE_CLIENT_ID` | ET-5 | Owner |
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
| [ ] | Cron heartbeat check not built | `/healthz` returns 503 when the retention cron heartbeat is over 36 h old (with the cron in ET-5) | `apps/worker`, runbook |

## 4. Remaining backlog

Slices ET-2 to ET-11 in [design/08-delivery-plan.md](design/08-delivery-plan.md).

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
| [ ] | Q-P2 Product name and domain | Owner | Domain needs an ADR (cost) |

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
