# 08 Delivery plan

One slice = one branch and PR (`ET-n-short-slug`). **Review** = run `security-compliance-reviewer` before merge.

## Phases (revised 10/11/2026 by the owner, ET-20)

The product's main draw is **alerts and customisable overlays**, with donation alerts on top; mini-games and other interactions follow. The owner chose to build the feature skeleton first on demo data and test on a real stream afterwards, then invite a few creators they know. The beta stays small and strictly $0.

- **Phase 1, product skeleton:** overlay theming, custom command alerts and Super Chat alerts, built and tested on synthetic chat. Then the owner's first real run, and fixes from it. Done when the owner's own test stream drives the styled poll, leaderboard and alerts overlays.
- **Invited beta gate:** the minimum privacy, terms and operations work before the first invited creator streams.
- **Phase 2, more interactions:** Vietnamese donation services, mini-games, richer animations, English UI. The tool never handles money (ADR-008).
- **Phase 3, public launch readiness** before open sign-up. Not planned while the beta stays small.

Accepted risk: the YouTube chat reader (`streamList`, Q-T1) is unproven until ET-15, so ET-13, ET-14, ET-17 and ET-21 may need rework after the real run. Each stays behind the `ChatSource` interface and the session engine to keep that rework small.

Already built and merged (kept, not reworked): ET-1 to ET-9.

## Phase 1 Product skeleton

| Slice | Delivers | IDs | Review | Needs owner setup |
| --- | --- | --- | --- | --- |
| ET-13 | Overlay customisation: per-widget theme (colours, font size, corner/position, background opacity, show/hide parts) set from the dashboard with live preview; stored per workspace; applied by the overlay page. Presets only, no custom CSS, HTML or uploaded files (non-negotiable 5, ADR-005) | FR-13, R5 | Yes (overlays) | No |
| ET-14 | Custom chat commands to overlay items: the creator defines up to 20 commands (e.g. `!hi`, `!tim`) that show an item on a new "alerts" widget: creator-written text plus a built-in sticker/emoji and animation from a fixed set; per-viewer and global cooldowns; viewer name only from session memory | FR-14, R5 | Yes (command parsing, overlays) | No |
| ET-17 | Donation alerts on the alerts widget: YouTube Super Chats, Super Stickers and new or gifted memberships as animations, read-only, no points, nothing stored (ADR-008). Built on synthetic events; verified in ET-15 | FR-15, R3, R8 | Yes (chat ingestion, overlays) | No |
| ET-21 | Free-limit fixes: dashboard live panel stops polling every 2 s (pause when hidden, slower interval or a session-authenticated WebSocket); points flush every ~10 minutes and at stop, with the live leaderboard drawn from session memory, so Neon can sleep during streams | NFR-COST, NFR-REL, R6 | Yes (data retention path) | No |
| ET-23 | One-step OBS setup: one combined "scene" overlay link the creator drags onto OBS (or copies), each widget keeping its own style and corner; dashboard setup card (YouTube connected, OBS connected, start) | FR-05, FR-13, US-02 | Yes (overlays, tokens) | No |
| ET-15 | First real run: deploy, Google sign-in end to end, `streamList` spike against a live test stream (ET-6 remainder), OBS check of every widget, fix what breaks, confirm whether publishing the OAuth app unverified removes the 7-day reconnect (R4) | FR-01, FR-03, Q-T1, Q-T3 | If code changes | **Yes** (SETUP §0–1) |

Build notes that keep later slices cheap:

- ET-13 stores each widget's settings in one per-widget config that ET-14 and ET-17 reuse (one workspace table, not three).
- ET-14 builds the alerts widget on a generic alert event (`command`, later `super_chat`, `membership`, `external`), so ET-17 and ET-19 add sources, not widgets. It also shows a short "commands you can type" hint, because viewers get no reply in chat (Q-P1).

Phase 1 exit: on the owner's own test stream, chat commands and Super Chats trigger the poll, leaderboard and alert items in their styled OBS overlay.

## Invited beta gate

Before the first invited creator streams. Their viewers are real people and may be children.

| Slice | Delivers | IDs | Review |
| --- | --- | --- | --- |
| ET-22 | Short Vietnamese privacy notice and terms (points have no value), a contact for viewer requests (Q-D1), rights flows checked end to end, error and uptime alerts reaching the owner, and the open retention gaps in SETUP §3 closed: queued revoke-and-delete, 30-day channel metadata refresh, cron heartbeat check | NFR-PRIV, FR-09, FR-12, Q-D1, R2, R3 | Yes |

## Phase 2 More interactions

| Slice | Delivers | IDs | Review |
| --- | --- | --- | --- |
| ET-19 | Vietnamese donation services on the alerts widget, one service per slice, each with its own ADR (after Q-T4 research, which needs no owner setup) | FR-16 | Yes |
| ET-10 | First mini-game: number guessing (`!doan 42`), points only. Work in progress parked on branch `ET-10-guess-game` (not reviewed) | FR-07, R8 | Yes |
| ET-16 | More mini-games and richer overlay animations (scheduled one by one) | FR-07 | Yes |
| ET-18 | English UI | NFR-I18N | No |

## Phase 3 Public launch readiness

Only if the tool opens beyond invited creators. Under strict $0 (owner, 10/11/2026) there is no custom domain, and Google app verification is likely to need one, so public sign-up may stay blocked until that decision changes (Q-P2, ADR-005).

| Slice | Delivers | IDs | Review |
| --- | --- | --- | --- |
| ET-11 | Counsel answers folded into the notice and terms, Google OAuth verification and YouTube quota-extension submissions, breach runbook confirmed, backups restore-tested | NFR-PRIV, Q-L1–Q-L4, R1, R4 | Yes |

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

### M3 Beta launch readiness (split into ET-22 and ET-11 above)

Other platforms (Twitch etc.) come after phase 3 and get IDs when scheduled.
