# 01 Architecture

## Components

```text
                Google OAuth + YouTube Data API (read-only)
                              ▲
                              │ packages/youtube (ChatSource, quota)
┌─────────────── Cloudflare Workers (apps/worker, Hono) ────────────────┐
│  /api/*   dashboard API, Google sign-in, sessions                      │
│  /o/*     overlay pages + WebSocket upgrade (token → workspace)        │
│  cron     retention, refresh, keep-alive                               │
│                                                                        │
│  LiveSession Durable Object (one per workspace live session)          │
│    chat stream → core.apply() → persist → broadcast; alarm watchdog    │
└───────────────┬───────────────────────────────┬────────────────────────┘
                │ packages/db (RLS context)     │ WebSocket (read-only)
                ▼                               ▼
        Neon Postgres (Singapore)        OBS browser source (apps/overlay)
                ▲
                │ HTTPS + session cookie
       Dashboard SPA (apps/web) – creators and moderators
```

## Packages and dependency direction

`apps/*` → `packages/youtube`, `packages/db` → `packages/core`. `core` imports nothing from other packages. `apps/web` and `apps/overlay` import only shared API types exported by `apps/worker` (a `types` entry with no runtime code).

| Package | Owns |
| --- | --- |
| `packages/core` | Normalisation (NFC, diacritic folding), command parser, poll, points, season and game rules; pure, clock injected |
| `packages/youtube` | `ChatSource` (real + fake), OAuth token refresh, quota ledger |
| `packages/db` | Repositories, migrations, `withWorkspace(ctx, fn)` transaction wrapper, isolation test helpers |
| `apps/worker` | Hono routes, auth, `LiveSession` DO, cron, static assets |
| `apps/web` | Dashboard (Vite + React), Vietnamese catalogs |
| `apps/overlay` | Overlay pages: plain TS + DOM, text-only rendering |

## Main flows

**Sign-in (US-01).** Dashboard → `/api/auth/google` → Google consent (scopes per ADR-003) → callback verifies state and PKCE, upserts member, encrypts and stores the refresh token, creates the workspace on first sign-in, sets the session cookie.

**Start session (US-03).** Dashboard → `POST /api/sessions` → Worker checks membership and role through `packages/db`, finds the active broadcast via `ChatSource`, derives the DO ID from `workspaceId:broadcastId`, and calls `start()` on the DO. The client never supplies a DO ID.

**Chat loop.** DO opens `ChatSource.stream(liveChatId, pageToken)` (`streamList`; quota ledger debits 5 units per connection) → each message normalised and parsed by `core` → state change applied in DO storage → overlay diff broadcast → points flushed to Postgres about every 10 s and at stop. On disconnect it reconnects from the last page token with backoff; a one-minute alarm restarts a stalled stream. Polling fallback: `list` on alarms at `pollingIntervalMillis`. Message text is dropped after parsing.

**Overlay (US-02).** OBS loads `/o/<token>/poll` → Worker hashes the token, looks up workspace and widget, serves the page → page opens a WebSocket that the Worker forwards to the workspace's active DO → DO sends a snapshot, then diffs.

**Stop.** Manual stop, broadcast end (`offlineAt` or chat ended error), quota budget reached, or token revoked → DO flushes, closes sockets with a reason code, clears display names.

## Failure behaviour

| Failure | Behaviour |
| --- | --- |
| YouTube 403 quota | Session stops; dashboard shows "quota used for today" with reset time |
| Postgres unreachable | DO keeps counting in its storage, retries flush with backoff; dashboard warns |
| DO evicted or restarted | State reloads from DO storage; overlay reconnects automatically |
| Google refresh token expired (Testing mode) | Session refuses to start; dashboard asks creator to reconnect |
