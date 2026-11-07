# Project status

Last updated: 08/11/2026 (ET-1). Update in every slice PR. Read after `CLAUDE.md`; then [SETUP.md](SETUP.md) for open work.

## Where we are

| Area | State |
| --- | --- |
| ET-1 Kickoff (rules, discovery, ADR-001–007, design 00/01/03/07/08, CI guardrails) | In review on branch `ET-1-project-kickoff` |
| Code | None yet; `pnpm` commands arrive in ET-2 |

## Next

**ET-2 Repo skeleton** (NFR-COST, NFR-I18N): pnpm workspace with `packages/core`, `packages/youtube`, `packages/db`, `apps/worker`, `apps/web`, `apps/overlay`; TypeScript strict, ESLint, Vitest, `pnpm check`; `wrangler.jsonc`; Vietnamese message catalog scaffold; `.nvmrc`; a "hello" Worker deployed by Cloudflare Workers Builds. No security review needed. ET-2 must also:

- remove the `detect` job guard from `.github/workflows/ci.yml` once `package.json` exists, so every gate always runs;
- approve pnpm build scripts explicitly and use versions at least a week old.

Only the deploy step needs the owner's Cloudflare account (SETUP §1, first row); everything else runs locally.

ET-3 (command engine) needs no owner setup and can follow straight after.

## Open PRs

| PR | What | Action |
| --- | --- | --- |
| ET-1 | Kickoff docs and guardrails | Owner reads non-negotiables, ADRs and delivery plan; merge |

## Waiting on the owner

Everything not done lives in [SETUP.md](SETUP.md), with priorities and exact steps.

## Environment facts

- GitHub: `kietly-web/engagement-tool`, **public** repository (docs are public; never commit real data or secrets). `main` not protected yet.
- Hosting (planned, ADR-001): Cloudflare Workers free plan, `*.workers.dev`. Account not created yet.
- Database (planned, ADR-002): Supabase free, Singapore. Project not created yet.
- Google Cloud project with YouTube Data API v3: not created yet; must never get a billing account (ADR-005).
- CLIs signed in for Claude: `gh` yes; `wrangler` no; `supabase` no.

## Gotchas we've hit

- Agents and skills added mid-session load only in a new session (`security-compliance-reviewer`, `slice`, `new-workspace-table` were added at kickoff).
- Actions were re-pinned to release SHAs on 08/11/2026; Dependabot keeps them current.
- The shell is zsh: unquoted variables holding several words don't split.
- Branch protection is off, so auto-merge would merge before CI. Wait for CI by hand until required checks are set (SETUP §1).
- pnpm blocks very recent releases and unapproved build scripts; pick versions at least a week old and approve build scripts explicitly.
- Google Testing-mode apps: refresh tokens for sensitive scopes expire after 7 days; beta creators will need to reconnect weekly until verification (R4).
- Supabase free projects pause after about a week idle; the daily cron touches the database (ADR-002).
- Supabase's transaction pooler forbids session-level `SET`; use `set_config(..., true)` inside the transaction.
- Test against a real Postgres engine (PGlite); never mock the database. Read every generated migration and reorder by hand if needed.
- Never hold a database transaction open across a network call (YouTube, Google).
- Normalise Unicode (NFC) before matching; test Vietnamese with and without diacritics, full-width digits (`２`) and look-alike characters.
- Overlay URLs are bearer secrets: never log `/o/*` paths.
