# Project status

Last updated: 24/11/2026 (ET-15 sign-in and demo mode work in production; ET-25 drag-and-drop scene layout in review). Update in every slice PR. Read after `CLAUDE.md`; then [SETUP.md](SETUP.md) for open work.

## Where we are

| Area | State |
| --- | --- |
| ET-1 Kickoff (rules, discovery, ADR-001–007, design 00/01/03/07/08, CI guardrails) | Done, [PR #1](https://github.com/kietly-web/engagement-tool/pull/1) |
| ET-2 Repo skeleton (workspace, six packages, Hono Worker, dashboard and overlay hello pages, `pnpm check`) | Done, [PR #2](https://github.com/kietly-web/engagement-tool/pull/2); deployed 23/11/2026 |
| ET-3 Command engine (normalisation, `!vote`/`!join` parser, polls, synthetic chat; `05-domain-engine.md`) | Done, [PR #3](https://github.com/kietly-web/engagement-tool/pull/3) |
| ET-4 Database foundation (tenancy migration, forced RLS, role-derived policies, `withWorkspace`, PGlite isolation suite; `02-data-model.md`; Q-T2 decided) | Done, [PR #4](https://github.com/kietly-web/engagement-tool/pull/4); applied to Neon 23/11/2026 |
| ET-5 Google sign-in (OAuth + PKCE, encrypted refresh token, sessions, disconnect, export, account deletion, Vietnamese dashboard) | Done, [PR #5](https://github.com/kietly-web/engagement-tool/pull/5); tested against a fake Google; **not verified with real Google** |
| ET-6 offline (session engine, `LiveSession` + `QuotaKeeper` Durable Objects, demo mode, YouTube polling reader, session and poll API, dashboard live panel) | Done, [PR #6](https://github.com/kietly-web/engagement-tool/pull/6); the `streamList` spike is still open |
| ET-7 Overlays (per-widget hashed tokens, rotation, overlay page and WebSocket from `LiveSession`, poll widget, dashboard links) | Done, [PR #7](https://github.com/kietly-web/engagement-tool/pull/7) |
| ET-8 Points and seasons (tally, idempotent 10 s flushes, ≤29-day seasons, leaderboard widget and dashboard, viewer erasure, retention every 6 h) | Done, [PR #8](https://github.com/kietly-web/engagement-tool/pull/8) |
| ET-9 Moderators (email-bound single-use invites, remove/leave, audit log for sensitive actions, members panel, invite accept flow) | Done, [PR #9](https://github.com/kietly-web/engagement-tool/pull/9) |

## Next

**Phase 1 is built (12/11/2026)**: ET-13 overlay styling, ET-14 command alerts, ET-17 Super Chat and membership alerts and ET-21 free-limit fixes are merged, on top of ET-1 to ET-9.

**ET-23 one-step OBS setup:** the owner's dashboard now has a setup card. Creator setup is: sign in with Google, then drag one button onto OBS (or copy one link). One "scene" link shows the poll, leaderboard and alerts, each in its own corner and style. Per-widget links still exist under "advanced".

**ET-25 drag-and-drop scene layout (24/11/2026, owner request):** the style panel now shows the whole scene; the creator drags each widget anywhere (or types X/Y) and sets its width; one save updates OBS. Stored as `position: "custom"` plus `x`, `y`, `width` in the existing widget config (no migration).

**ET-15 first real run, in progress (23/11/2026).** Parts A and B are done: the Worker is live at `https://engagement-tool.lythekiet333.workers.dev`, migrations 0001–0007 are applied to Neon (`neondb`), and the Hyperdrive ID and Google client ID are in `wrangler.jsonc`. The three Worker secrets are set and the owner confirmed sign-in works (24/11/2026); A1 (YouTube live streaming) is the owner's to confirm. Next is the owner's test, Part C of [runbooks/first-real-run.md](runbooks/first-real-run.md); Claude then fixes what the run finds. Expect rework: nothing has run against the real services, and the `streamList` reader is unproven (Q-T1).

After ET-15: **ET-22 invited beta gate** (privacy notice, terms, contact, alerts, retention gaps), then phase 2: ET-10 boss raid with the game framework, ET-24 shared pet, ET-19 Vietnamese donation services after Q-T4, ET-16 more games, ET-18 English. Owner picked boss raid and shared pet first (18/11/2026); games need no owner setup, so they can be built while ET-15 waits.

## Open PRs

| PR | What | Action |
| --- | --- | --- |
| ET-25 | Drag-and-drop scene layout and widget width | Merge when CI is green; then check it in OBS (SETUP §2) |

## Waiting on the owner

Everything not done lives in [SETUP.md](SETUP.md), with priorities and exact steps.

## Environment facts

- GitHub: `thekietly/engagement-tool`, **public** repository (docs are public; never commit real data or secrets). `main` not protected yet. It replaced `kietly-web/engagement-tool` on 23/11/2026: same history with new commit IDs, and PR numbers restarted at 1. The PR links for ET-1 to ET-9 above (and older PRs up to 21) point to the old repo, which still exists.
- Hosting (ADR-001): Cloudflare Workers free plan, `https://engagement-tool.lythekiet333.workers.dev`, deployed by Workers Builds from `main`.
- Database (ADR-002): Neon free, AWS Singapore, database `neondb` (not the Neon project's name). Reached through Hyperdrive `engagement-tool-db` as `app_worker`, caching disabled. A Neon MCP connector is configured in Claude but not yet authorised.
- Google Cloud project with YouTube Data API v3 and an OAuth web client (Testing mode); must never get a billing account (ADR-005).
- CLIs signed in for Claude: `gh` yes; `wrangler` yes (owner's Cloudflare account); `neonctl` no.
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
- `wrangler hyperdrive create` rewrites `wrangler.jsonc` (reformats it and appends the binding); restore the layout from git and add the binding by hand.
- `AppEnv` overrides `GOOGLE_CLIENT_ID` and `HYPERDRIVE` as optional (`Omit<Env, …>`), so a deploy without them answers 503 `not_configured`.
- On the owner's Windows machine `corepack enable` needs admin; use `corepack pnpm …`, or `corepack enable --install-directory <dir>` and put that dir on `PATH` (nested `pnpm` calls in scripts need it).
- Owner-run steps that need a secret (connection strings, passwords, keys) go through a script with a hidden `Read-Host -AsSecureString` prompt in a terminal tab, so the value never enters the chat. Validate every prompt's input before sending anything: a full connection string pasted at a "host" prompt once reached Cloudflare.
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
- Points flush about every 10 minutes (ET-21); the live leaderboard = season standings read once + unflushed tally. Don't shorten the interval without rechecking Neon compute hours.
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
- On a Windows checkout (CRLF), `wrangler types --check` reports `worker-configuration.d.ts` out of date. Run `pnpm --filter @et/worker types` (git shows no content change), then `git checkout` the file before committing.
- Overlay panels sit inside a `.holder` that carries the position; the panel inside is `zoom`ed by font size, which would also scale `left`/`top`.
- The scene editor iframe (`/overlay/?preview=scene&edit=1`) and the style panel talk by `postMessage` on one origin; both sides check origin and source and accept only the shapes in `SceneEditorMessage`.
