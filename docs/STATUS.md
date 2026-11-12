# Project status

Last updated: 12/11/2026 (ET-17). Update in every slice PR. Read after `CLAUDE.md`; then [SETUP.md](SETUP.md) for open work.

## Where we are

| Area | State |
| --- | --- |
| ET-1 Kickoff (rules, discovery, ADR-001–007, design 00/01/03/07/08, CI guardrails) | Done, [PR #1](https://github.com/kietly-web/engagement-tool/pull/1) |
| ET-2 Repo skeleton (workspace, six packages, Hono Worker, dashboard and overlay hello pages, `pnpm check`) | Done, [PR #2](https://github.com/kietly-web/engagement-tool/pull/2); runs locally, not deployed yet |
| ET-3 Command engine (normalisation, `!vote`/`!join` parser, polls, synthetic chat; `05-domain-engine.md`) | Done, [PR #3](https://github.com/kietly-web/engagement-tool/pull/3) |
| ET-4 Database foundation (tenancy migration, forced RLS, role-derived policies, `withWorkspace`, PGlite isolation suite; `02-data-model.md`; Q-T2 decided) | Done, [PR #4](https://github.com/kietly-web/engagement-tool/pull/4); not applied to Neon yet |
| ET-5 Google sign-in (OAuth + PKCE, encrypted refresh token, sessions, disconnect, export, account deletion, Vietnamese dashboard) | Done, [PR #5](https://github.com/kietly-web/engagement-tool/pull/5); tested against a fake Google; **not verified with real Google** |
| ET-6 offline (session engine, `LiveSession` + `QuotaKeeper` Durable Objects, demo mode, YouTube polling reader, session and poll API, dashboard live panel) | Done, [PR #6](https://github.com/kietly-web/engagement-tool/pull/6); the `streamList` spike is still open |
| ET-7 Overlays (per-widget hashed tokens, rotation, overlay page and WebSocket from `LiveSession`, poll widget, dashboard links) | Done, [PR #7](https://github.com/kietly-web/engagement-tool/pull/7) |
| ET-8 Points and seasons (tally, idempotent 10 s flushes, ≤29-day seasons, leaderboard widget and dashboard, viewer erasure, retention every 6 h) | Done, [PR #8](https://github.com/kietly-web/engagement-tool/pull/8) |
| ET-9 Moderators (email-bound single-use invites, remove/leave, audit log for sensitive actions, members panel, invite accept flow) | Done, [PR #9](https://github.com/kietly-web/engagement-tool/pull/9) |

## Next

Plan revised by the owner on 10/11/2026 (ET-20, see `docs/design/08-delivery-plan.md`). The main draw is **alerts and customisable overlays** with donation alerts; mini-games come later. Build the feature skeleton first on demo data, then the owner tests on a real stream and invites a few creators they know. Small beta, strictly $0.

1. **ET-13 Overlay customisation** (FR-13): done, [PR #12](https://github.com/kietly-web/engagement-tool/pull/12).
2. **ET-14 Custom chat commands to overlay alerts** (FR-14): done, [PR #13](https://github.com/kietly-web/engagement-tool/pull/13).
3. **ET-17 Super Chat and membership alerts** (FR-15, ADR-008): in review on branch `ET-17-super-chat-alerts`; verified on synthetic events only.
4. **ET-21 Free-limit fixes**: dashboard polling and points flush interval.
5. **ET-15 First real run**: needs the owner's setup (SETUP §0–1) and a test live stream. Expect rework here: nothing has run against real Google, YouTube, Cloudflare or Neon, and the `streamList` reader is unproven (Q-T1).
6. **ET-22 Invited beta gate**: before the first invited creator streams.

Slices 1 to 4 need no owner setup. Later: ET-19 Vietnamese donation services (after Q-T4 research), ET-10/ET-16 mini-games (ET-10 is parked on branch `ET-10-guess-game`, unreviewed), ET-18 English, ET-11 public launch.

## Open PRs

| PR | What | Action |
| --- | --- | --- |
| ET-20 | Delivery plan revision (docs only) | Merge when CI is green |

## Waiting on the owner

Everything not done lives in [SETUP.md](SETUP.md), with priorities and exact steps.

## Environment facts

- GitHub: `kietly-web/engagement-tool`, **public** repository (docs are public; never commit real data or secrets). `main` not protected yet.
- Hosting (planned, ADR-001): Cloudflare Workers free plan, `*.workers.dev`. Account not created yet.
- Database (planned, ADR-002): Neon free, AWS Singapore. Project not created yet. A Neon MCP connector is configured in Claude but not yet authorised.
- Google Cloud project with YouTube Data API v3: not created yet; must never get a billing account (ADR-005).
- CLIs signed in for Claude: `gh` yes; `wrangler` no; `neonctl` no.
- Toolchain: Node 24 (`.nvmrc`), pnpm 12.16.1 (`packageManager`), TypeScript 6.0, Vite 8, Vitest 5, Hono 4, Wrangler 4, React 19.

## Gotchas we've hit

- Agents and skills added mid-session load only in a new session (`security-compliance-reviewer`, `slice`, `new-workspace-table` were added at kickoff). A session started before the kickoff files existed sees the template reviewer: brief a general-purpose agent to follow `.claude/agents/security-compliance-reviewer.md` instead.
- `packages/core` has no DOM or Node types on purpose (no I/O): use `Date.now()` rather than `performance`, and inject a `Clock` for anything stored.
- Actions were re-pinned to release SHAs on 08/11/2026; Dependabot keeps them current.
- The shell is zsh: unquoted variables holding several words don't split.
- Branch protection is off, so auto-merge would merge before CI. Wait for CI by hand until required checks are set (SETUP §1).
- Write invisible and bidi characters as `\u` escapes in source and tests, never literally; Semgrep blocks literal ones (Trojan Source). Tool-written files can decode escapes, so grep for them before pushing.
- `pnpm-workspace.yaml` enforces `minimumReleaseAge` (7 days) and an `allowBuilds` list (only `esbuild`, `workerd`), and blocks exotic sub-dependencies and provenance downgrades. Add to `allowBuilds` only after checking what the script does.
- TypeScript stays on 6.0 until typescript-eslint supports 7 (its peer range is `<6.1`).
- `wrangler.jsonc` changes need `pnpm --filter @et/worker types` and committing `worker-configuration.d.ts`; `pnpm typecheck` fails until you do.
- `wrangler types` types `vars` as literals, so compare them as strings (`String(env.SESSIONS_DISABLED) === "true"`).
- Durable Object RPC loses custom error classes, so `LiveSession` methods return `{ ok, value | error }` results instead of throwing.
- `securityHeaders` only fills headers a route hasn't set, so overlay pages can carry their own CSP; API routes get the strict default.
- Workers Logs invocation logs are off on purpose: they record full URLs, and overlay URLs carry tokens. Log with `console.log` and never include `/o/*` paths.
- Static assets (dashboard, overlay files) are served without invoking the Worker, so they don't count toward the 100,000 requests/day; only `/api/*`, `/o/*` and `/healthz` do (`run_worker_first`).
- Static-asset security headers live in `apps/web/public/_headers`; Worker responses get them from `apps/worker/src/security-headers.ts`. Change both together.
- Google Testing-mode apps: refresh tokens for sensitive scopes expire after 7 days; beta creators will need to reconnect weekly until verification (R4).
- Neon free compute sleeps after 5 minutes idle and takes a few hundred ms to wake; the Durable Object buffers writes, so never block chat handling on a database call.
- Pooled connections forbid session-level `SET`; set the RLS context with `set_config(..., true)` inside the transaction (`withWorkspace` does this).
- Hyperdrive must keep `--caching-disabled`: its cache ignores the RLS context.
- Create Neon login roles with SQL, not the console (console roles join `neon_superuser`, which bypasses RLS).
- Points flushes are batches with IDs recorded in `app.points_batch`; never "restore and retry" deltas without the same batch ID, or points double-count.
- Seasons start at the database's `now()`, not the Worker's clock; mixing the two made a fresh season look inactive in tests.
- Never edit an applied migration; the migrator compares checksums and refuses. Add a new numbered file.
- `node` runs `packages/db/scripts/*.ts` directly (Node 24 type stripping), so those imports need explicit `.ts` extensions.
- Stack reviewed 08/11/2026 against current free tiers: Supabase replaced by Neon (no inactivity pause), YouTube chat read with `streamList` instead of polling (ADR-002, ADR-004).
- Test against a real Postgres engine (PGlite); never mock the database. Read every generated migration and reorder by hand if needed.
- Never hold a database transaction open across a network call (YouTube, Google); `auth.ts` reads ciphertext in one transaction, calls Google, then writes in another.
- Don't revoke an old refresh token when a creator reconnects: Google's revoke ends the app's whole grant, including the new token. For the same reason, a failed re-sign-in never revokes the new token if the creator already has a working connection.
- Safari rejects `Secure`/`__Host-` cookies on `http://localhost`, so local sign-in fails there (`?signin=state`). Test locally in Chrome or Firefox.
- Worker tests typecheck with `apps/worker/tsconfig.test.json` (adds Node types); production code uses only Workers types.
- Normalise Unicode (NFC) before matching; test Vietnamese with and without diacritics, full-width digits (`２`) and look-alike characters.
- Overlay URLs are bearer secrets: never log `/o/*` paths.
