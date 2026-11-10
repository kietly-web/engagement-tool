# 08 Delivery plan

One slice = one branch and PR (`ET-n-short-slug`). **Review** = run `security-compliance-reviewer` before merge.

## Phases (reprioritised 10/11/2026 by the owner)

- **Phase 1, demo:** prove the core loop on a real stream. Viewers type commands in YouTube chat, and creator-customised items appear in the OBS browser source. Done when a beta creator sees their own chat commands drive their own styled overlay live.
- **Phase 2, interactive features:** mini-games, more widgets and richer animations, in the spirit of Twitch and TikTok LIVE interactivity but on YouTube. Donation/Super Chat items are **not scheduled** until the owner decides Q-P3 (scope change; see discovery).
- **Phase 3, beta launch readiness** before anyone outside the test-user list signs in.

Already built and merged (kept, not reworked): ET-1 to ET-9. Most of phase 1 exists; the phase 1 slices below fill the gaps.

## Phase 1 Demo

| Slice | Delivers | IDs | Review | Needs owner setup |
| --- | --- | --- | --- | --- |
| ET-13 | Overlay customisation: per-widget theme (colours, font size, corner/position, background opacity, show/hide parts) set from the dashboard with live preview; stored per workspace; applied by the overlay page. Presets only, no custom CSS, HTML or uploaded files (non-negotiable 5, ADR-005) | FR-13, R5 | Yes (overlays) | No |
| ET-14 | Custom chat commands to overlay items: the creator defines up to 20 commands (e.g. `!hi`, `!tim`) that show an item on a new "alerts" widget: creator-written text plus a built-in sticker/emoji and animation from a fixed set; per-viewer and global cooldowns; viewer name only from session memory | FR-14, R5 | Yes (command parsing, overlays) | No |
| ET-15 | First real run: deploy, Google sign-in end to end, `streamList` spike against a live test stream (ET-6 remainder), OBS check of every widget, fix what breaks | FR-01, FR-03, Q-T1, Q-T3 | If code changes | **Yes** (SETUP §0–1) |

Phase 1 exit: on the owner's own test stream, chat commands trigger the poll, leaderboard and custom alert items in their styled OBS overlay.

## Phase 2 Interactive features

| Slice | Delivers | IDs | Review |
| --- | --- | --- | --- |
| ET-10 | First mini-game: number guessing (`!doan 42`), points only. Work in progress parked on branch `ET-10-guess-game` (not reviewed) | FR-07, R8 | Yes |
| ET-16 | More mini-games and richer overlay animations (scheduled one by one) | FR-07 | Yes |
| ET-17 | **Proposed, needs Q-P3:** show YouTube Super Chats, Super Stickers and new memberships as overlay animations (read-only, from the same chat stream) | FR-15 (proposed) | Yes |
| ET-18 | English UI | NFR-I18N | No |

## Phase 3 Beta launch readiness

| Slice | Delivers | IDs | Review |
| --- | --- | --- | --- |
| ET-11 | Privacy notice and terms (VN, drafts for counsel), contact for viewer requests, rights flows verified, alerts, smoke test on production, Google OAuth verification and YouTube quota-extension submissions prepared | NFR-PRIV, Q-L1–Q-L4, Q-D1, R4 | Yes |

## Built so far (history)

### M0 Foundations

| Slice | Delivers | IDs | Review |
| --- | --- | --- | --- |
| ET-1 | Kickoff: rules, discovery IDs, ADRs, design pack, CI guardrails | all | No |
| ET-2 | Repo skeleton: pnpm workspace, the six packages/apps, TypeScript strict, lint/test/build, `pnpm check`, `wrangler.jsonc`, message catalogs, a "hello" Worker deployed by Workers Builds, CI fully green, Actions re-pinned | NFR-COST, NFR-I18N | No |
| ET-3 | Command engine in `packages/core`: NFC + diacritic folding, `!vote`/`!binhchon`, `!join`, polls, synthetic chat generator; writes `05-domain-engine.md` | FR-04, FR-08, US-04 | Yes (command parsing) |
| ET-4 | Database foundation: migrations, `workspace` + `member` tables, `app_runtime` role, forced RLS, `withWorkspace`, PGlite isolation harness, `new-workspace-table` skill refined; writes `02-data-model.md`; decides Q-T2 | NFR-SEC, R7 | Yes |
| ET-5 | Google sign-in and workspace: OAuth with PKCE, encrypted refresh token, session cookie, disconnect = revoke + scheduled deletion, account export/delete | FR-01, FR-09, US-01, US-08 | Yes |

### M1 First live poll on a real stream

| Slice | Delivers | IDs | Review |
| --- | --- | --- | --- |
| ET-6 | `LiveSession` DO and `ChatSource`: spike proving `streamList` with `youtube.readonly` first, then find broadcast, stream chat (polling fallback), watchdog alarm, quota ledger, start/stop from the dashboard, quota display; measures Q-T1 and Q-T3 | FR-03, FR-11, NFR-QUOTA, NFR-REL, R1 | Yes (chat ingestion, external API) |
| ET-7 | Overlays and polls end to end: per-widget tokens and rotation, overlay WebSocket, poll widget, dashboard poll controls, CSP and headers | FR-04, FR-05, US-02, US-07, R5 | Yes (overlays, tokens) |

M1 exit: a beta creator runs a poll on a real stream with an OBS overlay.

### M2 Loyalty and moderators

| Slice | Delivers | IDs | Review |
| --- | --- | --- | --- |
| ET-8 | Points and seasons: per-viewer counters, ≤30-day seasons, leaderboard widget, retention cron, erase viewer by channel ID | FR-06, FR-12, US-05, US-09, R2, R3 | Yes (data retention) |
| ET-9 | Moderators: invite by verified email, roles, RLS policies per role, audit log | FR-02, US-06, R7 | Yes (access control) |
| ET-10 | First mini-game (moved to phase 2) | FR-07, R8 | Yes (command parsing) |

### M3 Beta launch readiness (moved to phase 3 above)

| Slice | Delivers | IDs | Review |
| --- | --- | --- | --- |
| ET-11 | Privacy notice and terms (VN, drafts for counsel), contact for viewer requests, rights flows verified, alerts, smoke test on production, Google OAuth verification and YouTube quota-extension submissions prepared | NFR-PRIV, Q-L1–Q-L4, Q-D1, R4 | Yes |

Other platforms (Twitch etc.) come after phase 3 and get IDs when scheduled.
