# 08 Delivery plan

One slice = one branch and PR (`ET-n-short-slug`). **Review** = run `security-compliance-reviewer` before merge.

## M0 Foundations

| Slice | Delivers | IDs | Review |
| --- | --- | --- | --- |
| ET-1 | Kickoff: rules, discovery IDs, ADRs, design pack, CI guardrails | all | No |
| ET-2 | Repo skeleton: pnpm workspace, the six packages/apps, TypeScript strict, lint/test/build, `pnpm check`, `wrangler.jsonc`, message catalogs, a "hello" Worker deployed by Workers Builds, CI fully green, Actions re-pinned | NFR-COST, NFR-I18N | No |
| ET-3 | Command engine in `packages/core`: NFC + diacritic folding, `!vote`/`!binhchon`, `!join`, polls, synthetic chat generator; writes `05-domain-engine.md` | FR-04, FR-08, US-04 | Yes (command parsing) |
| ET-4 | Database foundation: migrations, `workspace` + `member` tables, `app_runtime` role, forced RLS, `withWorkspace`, PGlite isolation harness, `new-workspace-table` skill refined; writes `02-data-model.md`; decides Q-T2 | NFR-SEC, R7 | Yes |
| ET-5 | Google sign-in and workspace: OAuth with PKCE, encrypted refresh token, session cookie, disconnect = revoke + scheduled deletion, account export/delete | FR-01, FR-09, US-01, US-08 | Yes |

## M1 First live poll on a real stream

| Slice | Delivers | IDs | Review |
| --- | --- | --- | --- |
| ET-6 | `LiveSession` DO and `ChatSource`: find broadcast, poll chat on alarms, quota ledger, start/stop from the dashboard, quota display; measures Q-T1 and Q-T3 | FR-03, FR-11, NFR-QUOTA, NFR-REL, R1 | Yes (chat ingestion, external API) |
| ET-7 | Overlays and polls end to end: per-widget tokens and rotation, overlay WebSocket, poll widget, dashboard poll controls, CSP and headers | FR-04, FR-05, US-02, US-07, R5 | Yes (overlays, tokens) |

M1 exit: a beta creator runs a poll on a real stream with an OBS overlay.

## M2 Loyalty and moderators

| Slice | Delivers | IDs | Review |
| --- | --- | --- | --- |
| ET-8 | Points and seasons: per-viewer counters, ≤30-day seasons, leaderboard widget, retention cron, erase viewer by channel ID | FR-06, FR-12, US-05, US-09, R2, R3 | Yes (data retention) |
| ET-9 | Moderators: invite by verified email, roles, RLS policies per role, audit log | FR-02, US-06, R7 | Yes (access control) |
| ET-10 | First mini-game (points only, no prizes) | FR-07, R8 | Yes (command parsing) |

## M3 Beta launch readiness

| Slice | Delivers | IDs | Review |
| --- | --- | --- | --- |
| ET-11 | Privacy notice and terms (VN, drafts for counsel), contact for viewer requests, rights flows verified, alerts, smoke test on production, Google OAuth verification and YouTube quota-extension submissions prepared | NFR-PRIV, Q-L1–Q-L4, Q-D1, R4 | Yes |

English UI, more games and other platforms come after M3 and get IDs when scheduled.
