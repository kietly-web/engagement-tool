# Engagement Tool

A free live-stream engagement tool for YouTubers and VTubers, starting with Vietnamese creators. Viewers type commands in YouTube live chat (`!vote 2`, `!join`); the tool reads the chat read-only, runs polls, mini-games and seasonal loyalty points, and shows the results on overlays the creator adds to OBS as a Browser Source. Creators and their moderators use a web dashboard; viewers never sign in. Real users are expected, so security, privacy and law apply in full, and viewers must be treated as possibly children. It runs at $0 on free plans until there is traction.

**Before starting any work, read [`docs/STATUS.md`](docs/STATUS.md)**, then [`docs/SETUP.md`](docs/SETUP.md) for anything not done yet.

## Where things are

| Path | What |
| --- | --- |
| `docs/STATUS.md` | Current stage, next slice, environment facts, gotchas. Read first; update in every slice PR |
| `docs/SETUP.md` | Everything not done: settings and secrets (where and how), security fixes, gaps, backlog, open questions, future ideas, launch readiness. Add a row whenever you leave something unfinished |
| `docs/compliance/` | Personal-data inventory and other compliance drafts. Update when a personal-data field is added, moved or dropped |
| `docs/runbooks/operations.md` | Backups, rollback, alerts, incident and breach response |
| `README.md` | Folder map and page list. Update it when you add a top-level folder, package or page |
| `docs/discovery/discovery-summary.md` | Requirement, story, risk and question IDs. Cite these IDs |
| `docs/design/` | Design pack (`00` overview, `01` architecture, `03` security and privacy, `07` infrastructure, `08` delivery plan; `02` and `05` are written by the slices named in `08`) |
| `docs/adr/` | Decision records |
| `.claude/agents/`, `.claude/skills/` | Project reviewers and workflows |

## Commands

Commands exist from slice ET-2 (repo skeleton) onward.

| Command | Does |
| --- | --- |
| `pnpm install` | Install |
| `pnpm dev` | Run the Worker, dashboard and overlays locally (`wrangler dev` + Vite) |
| `pnpm check` | Lint + typecheck + tests; run before every push |
| `pnpm build` | Production build |

## Non-negotiables

Do not trade these away for convenience; raise an ADR instead.

1. **Read-only on YouTube.** Request only `youtube.readonly` (plus `openid email profile`); call no YouTube method that writes, posts, deletes or moderates. (Source: owner decision, R4, ADR-004)
2. **Minimum viewer data; every viewer may be a child.** Per viewer, store only the YouTube channel ID and per-workspace counters. Never store chat message text, avatars or profile data. Display names live only in the live session's memory and are dropped when the session ends. No viewer accounts, sign-up, tracking or targeting. (Source: VN PDPL Law 91/2025/QH15 and Decree 356/2025/ND-CP, R3, NFR-PRIV, ADR-006)
3. **YouTube data lifecycle.** Nothing obtained from the YouTube API is kept longer than 30 days unless refreshed; points run in seasons of at most 30 days until Q-L3 is answered. When a creator disconnects, revoke the Google token immediately and delete their workspace's YouTube data within 7 days. (Source: YouTube API Developer Policies III.D.2 and III.E.4, R2)
4. **Tenant isolation is enforced by Postgres.** Every workspace table has row-level security enabled and forced; the app connects as a role that cannot bypass it. Moderators act only inside workspaces they were invited to, within their role. Durable Object IDs are derived on the server from the workspace and broadcast, never taken from the client. (Source: R7, NFR-SEC, ADR-002)
5. **Overlays are untrusted-input sinks.** Chat-derived text is rendered as text only (no HTML, no markdown, no URLs made clickable). Overlay URLs carry a per-widget secret token that the creator can rotate; overlay endpoints are read-only and expose nothing beyond what is drawn on screen. (Source: R5)
6. **Points have no money value.** Points and game results can never be bought, sold, transferred, cashed out or exchanged for prizes or anything of value. (Source: owner decision; VN gambling and promotion rules, R8)
7. **$0 by design.** Use only free plans that fail closed (stop or error) instead of billing; no card on file that can auto-upgrade. Adding any paid service or plan needs an ADR first. (Source: owner decision, NFR-COST, ADR-005)
8. **Production stays in production.** Production data and credentials never reach preview, development or tests; tests and demos use synthetic chat generated in code. (Source: real users, NFR-SEC)

## Package / module rules

- `packages/core`: pure domain logic (command parsing, polls, games, points rules, seasons). No I/O, no imports from other packages; time comes from an injected clock.
- `packages/youtube`: the only code that calls YouTube. Exposes a read-only `ChatSource` interface and owns quota accounting. It has no write methods.
- `packages/db`: the only code that talks to Postgres. Repository interfaces plus migrations; every query runs inside a transaction that sets the workspace context for RLS. Nothing outside it imports the driver, so the database can move.
- `apps/worker`: Hono API, Google sign-in, the `LiveSession` Durable Object and cron jobs. Secrets are read only from the Worker `env` in server code, never sent to the browser.
- `apps/web`: dashboard SPA (Vite + React). `apps/overlay`: OBS overlay pages. Both depend only on the API's shared types; any `VITE_*` value is public.
- Tests: anything touching Postgres runs against a real engine (PGlite) with synthetic data, including cross-workspace isolation tests for every workspace table. Never mock the database.

## Conventions

- TypeScript strict everywhere. Times stored in UTC, shown in `Asia/Ho_Chi_Minh` by default. Points are integers.
- Chat text is normalised to Unicode NFC before parsing; commands match with and without Vietnamese diacritics.
- UI copy is Vietnamese first (English to follow) and lives in message catalogs from day one. Docs and code are English only; never translate a document.
- Commit subjects, PR titles and branch names: `ET-123 short imperative description`; branch `ET-123-short-slug`, ≤ 60 chars, no brackets or colons.
- PR descriptions follow `.github/pull_request_template.md`; "What changed" is required (CI checks it).
- Code comments: default none; only a non-obvious why, a gotcha or an external constraint.

## How we work (lean mode)

1. **Ship slices, not items.** One branch and PR per slice; list every backlog ID in the PR.
2. **CI is the gate.** Run the checks before pushing; merge when CI and the preview are green.
3. **Review what's risky.** Run `security-compliance-reviewer` on slices that change migrations or access control, auth, chat ingestion or command parsing, overlays or their tokens, data retention, or add an external service.
4. **Docs follow contracts.** Edit a design doc when a contract changes; decisions get ADRs; scope changes update the discovery IDs; implementation notes go in the PR.
5. **Flag unfinished work in `docs/SETUP.md`** in the same PR. Secrets go into the Cloudflare Worker secret store (`wrangler secret put`), never into `wrangler.jsonc` `vars` or a `VITE_` name.
6. **Migrations are backward compatible**: expand, deploy, contract.
7. **Keep `docs/STATUS.md` current** in every slice PR.
8. **Watch the free limits.** A slice that adds load (requests, Durable Object time, YouTube quota, database size) states its estimate against the limits in `docs/design/07-infrastructure.md`.

## Working with other agents

Subagents and new sessions see the repo, not the conversation. Brief them with the stage (STATUS), the slice IDs, the branch, the files in scope and what done looks like. A subagent doesn't commit, push or merge unless told to. Verify what comes back.

## Merging (owner's rule)

- Claude may commit, push branches, open PRs and enable auto-merge on conflict-free PRs once required checks are configured on `main`. Until then, Claude waits for CI to pass before merging.
- Merge conflicts go to the owner (`kietly-web`); Claude never resolves them, rebases or force-pushes.
- Never bypass branch protection.
