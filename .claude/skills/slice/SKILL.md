---
name: slice
description: Build the next slice of the engagement tool end to end: pick it from docs/STATUS.md, branch, build with tests, run checks, get a security review when the slice is risky, update STATUS and SETUP, open the PR and merge under the owner's rules. Use whenever the owner says "start slice X", "continue the backlog", "next slice" or names ET- IDs.
---

# Build a slice

1. **Orient.** Read `docs/STATUS.md` (next slice, gotchas), `docs/SETUP.md` (open items touching this slice) and the slice's row in `docs/design/08-delivery-plan.md`. `git switch main && git pull`.
2. **Branch.** `ET-n-short-kebab-slug`, at most 60 characters, no brackets or colons.
3. **Build with tests.** Follow the CLAUDE.md package rules. Anything touching Postgres runs against PGlite with synthetic data, including cross-workspace isolation tests (use the `new-workspace-table` skill for new tables). Chat input comes from the synthetic generator in `packages/core`; add adversarial cases (HTML, bidi overrides, zalgo, full-width digits, very long messages, Vietnamese with and without diacritics).
4. **Check.** Run `pnpm check` and `pnpm build` before pushing.
5. **Review if risky.** If the slice changes migrations or access control, auth, chat ingestion or command parsing, overlays or their tokens, data retention, or adds an external service, run the `security-compliance-reviewer` agent on the diff. Fix blockers and should-fixes; record notes you don't fix in `docs/SETUP.md`.
6. **Watch the free limits.** If the slice adds requests, Durable Object time, YouTube quota or database size, put an estimate against `docs/design/07-infrastructure.md` in the PR.
7. **Update the record.** `docs/STATUS.md` (done, next, gotchas); `docs/SETUP.md` (new settings, secrets, gaps, ideas); `docs/compliance/data-inventory.md` if a personal-data field changed; `docs/discovery/discovery-summary.md` if scope changed (new IDs, never renumber); design docs or ADRs only if a contract or decision changed; README folder map if you added a folder, package or page.
8. **PR.** Commit subject and PR title `ET-n short imperative description`; fill "What changed"; list every backlog ID.
9. **Merge** only as `CLAUDE.md` allows. While `main` has no required checks, wait for CI to pass before merging. Never resolve conflicts, rebase or force-push; hand conflicts to the owner (`kietly-web`).
10. **Report** in plain language: what a creator can now do, what the review found and fixed, what's still not verified, and what the owner must do next.
