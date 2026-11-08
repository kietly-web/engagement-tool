# Project status

Last updated: 08/11/2026 (ET-3). Update in every slice PR. Read after `CLAUDE.md`; then [SETUP.md](SETUP.md) for open work.

## Where we are

| Area | State |
| --- | --- |
| ET-1 Kickoff (rules, discovery, ADR-001–007, design 00/01/03/07/08, CI guardrails) | Done, [PR #1](https://github.com/kietly-web/engagement-tool/pull/1) |
| ET-2 Repo skeleton (workspace, six packages, Hono Worker, dashboard and overlay hello pages, `pnpm check`) | Done, [PR #2](https://github.com/kietly-web/engagement-tool/pull/2); runs locally, not deployed yet |
| ET-3 Command engine (normalisation, `!vote`/`!join` parser, polls, synthetic chat; `05-domain-engine.md`) | In review on branch `ET-3-command-engine` |

## Next

**ET-4 Database foundation** (NFR-SEC, R7): `packages/db` with migrations, `workspace` and `member` tables, the `app_runtime` role, forced RLS, a `withWorkspace` transaction wrapper and a PGlite isolation harness; refine the `new-workspace-table` skill; write `docs/design/02-data-model.md`; decide Q-T2 (Hyperdrive vs Neon serverless driver). Needs the security review. Builds and tests fully on PGlite; only applying migrations to production needs the owner's Neon project (SETUP §1).

Deploying the Worker needs the owner's Cloudflare account and Workers Builds connection (SETUP §1, first two rows); it can happen any time.

## Open PRs

| PR | What | Action |
| --- | --- | --- |
| ET-3 | Command engine | Merge when CI is green and review findings are fixed |

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
- Workers Logs invocation logs are off on purpose: they record full URLs, and overlay URLs carry tokens. Log with `console.log` and never include `/o/*` paths.
- Static assets (dashboard, overlay files) are served without invoking the Worker, so they don't count toward the 100,000 requests/day; only `/api/*`, `/o/*` and `/healthz` do (`run_worker_first`).
- Static-asset security headers live in `apps/web/public/_headers`; Worker responses get them from `apps/worker/src/security-headers.ts`. Change both together.
- Google Testing-mode apps: refresh tokens for sensitive scopes expire after 7 days; beta creators will need to reconnect weekly until verification (R4).
- Neon free compute sleeps after 5 minutes idle and takes a few hundred ms to wake; the Durable Object buffers writes, so never block chat handling on a database call.
- Pooled connections forbid session-level `SET`; set the RLS context with `set_config(..., true)` inside the transaction.
- Stack reviewed 08/11/2026 against current free tiers: Supabase replaced by Neon (no inactivity pause), YouTube chat read with `streamList` instead of polling (ADR-002, ADR-004).
- Test against a real Postgres engine (PGlite); never mock the database. Read every generated migration and reorder by hand if needed.
- Never hold a database transaction open across a network call (YouTube, Google).
- Normalise Unicode (NFC) before matching; test Vietnamese with and without diacritics, full-width digits (`２`) and look-alike characters.
- Overlay URLs are bearer secrets: never log `/o/*` paths.
