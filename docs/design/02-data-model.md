# 02 Data model

Postgres (Neon, Singapore). Everything lives in schema `app`; migrations are plain SQL in `packages/db/migrations/NNNN_name.sql`, applied in order and recorded with a checksum in `public.schema_migrations`. Written by ET-4.

## Roles

| Role | Login | Purpose |
| --- | --- | --- |
| Owner (`neondb_owner` in Neon; a CREATEROLE non-superuser in tests, to match) | Yes | Runs migrations and owns the tables. Never used by the Worker. Holds `app_definer` with `INHERIT FALSE`, so it doesn't fall under `definer_all` |
| `app_runtime` | No | Every app transaction runs as this role (`SET LOCAL ROLE app_runtime`). No `BYPASSRLS`, owns nothing, column-level grants only; can't read `email` or `google_sub` |
| `app_worker` | Yes | The Worker's login, created by the owner with SQL (SETUP §1) as a member of `app_runtime` |
| `app_definer` | No | Owns the `SECURITY DEFINER` functions; sees all rows only through explicit `definer_all` policies |

Create `app_worker` with SQL, not through the Neon console: console-created roles join `neon_superuser`.

## Context

`packages/db` opens every transaction with `SET LOCAL ROLE app_runtime`, then sets transaction-local settings:

| Wrapper | Settings | Use |
| --- | --- | --- |
| `withSystem` | none | Sign-in only (`app.upsert_member`) |
| `withMember` | `app.member_id` | Listing my workspaces, creating my workspace, my profile |
| `withWorkspace` | `app.member_id`, `app.workspace_id` | Everything inside a workspace |

The app never passes a role. Policies compute it with `app.role_in(workspace)` from `workspace_member`, so pointing `app.workspace_id` at a workspace you don't belong to shows nothing. Context IDs must be UUIDs before they reach SQL.

## Tables

| Table | Columns | Notes |
| --- | --- | --- |
| `app.member` | `id`, `google_sub` (unique), `email`, `display_name`, `created_at`, `updated_at` | A person who signs in (creator or moderator). No photo (ADR-003) |
| `app.workspace` | `id`, `name` (1–80), `created_at` | One per creator; YouTube channel columns arrive in ET-5 |
| `app.workspace_member` | `workspace_id`, `member_id`, `role` (`owner`/`moderator`), `created_at` | PK (workspace, member); at most one owned workspace per member (FR-01) |
| `app.session` (ET-5) | `token_hash` (HMAC, 32 bytes), `member_id`, `created_at`, `last_seen_at`, `expires_at` | No `app_runtime` grant at all; only `create_session`, `session_member`, `delete_session` |
| `app.overlay_token` (ET-7) | `workspace_id`, `widget` (`poll`/`leaderboard`/`game`), `token_hash` (SHA-256, unique), `created_at`, `rotated_at` | PK (workspace, widget). Members read widget and dates only; `rotate_overlay_token()` is owner-only; `overlay_lookup()` resolves a hash without any member context |
| `app.season` (ET-8) | `id`, `workspace_id`, `name` (1–60), `starts_at`, `ends_at` (at most 29 days after start, so cleanup lag stays inside 30), `created_at` | Owner creates (starting at the database's `now()`, never overlapping) and may only end a running season early; members read |
| `app.points_batch` (ET-8) | `batch_id` (PK), `season_id`, `workspace_id`, `applied_at` | Marks each applied flush so a retried batch is applied once; no personal data; deleted with ended seasons |
| `app.viewer_points` (ET-8) | `season_id`, `workspace_id`, `channel_id` (checked format), `points`, `joins`, `votes` (all ≥ 0), `updated_at` | PK (season, channel). Members read; inserts and updates only into a running season, by the member who started the live session; owner deletes (erasure). Rows of ended seasons are deleted by `daily_maintenance()` |
| `app.maintenance_heartbeat` (ET-8) | `ran_at` | Single row written by the retention job (every 6 h) |
| `app.invite` (ET-9) | `id`, `workspace_id`, `email` (lower-case), `token_hash` (SHA-256, unique), `created_by`, `created_at`, `expires_at` (≤ 7 days), `accepted_at` | One pending invite per address (a new one replaces the old). Owner lists and revokes pending invites (no hash); `create_invite()` is owner-only with at most 20 pending; `invite_preview()` shows the channel name before joining; `accept_invite()` requires the caller's verified Google email to match, is single-use, and clears other pending invites for that address. `remove_member()` (owner removes, moderator leaves) also clears that person's pending invites and logs only on success |
| `app.audit_event` (ET-9) | `id`, `workspace_id`, `actor_member_id`, `actor_name` (snapshot), `action` (fixed list including session start/stop), `detail` (≤ 500 bytes), `created_at` | Written through `app.audit()` by members of the workspace (in the same transaction as the action); read by the owner; deleted after 12 months |
| `app.youtube_connection` (ET-5) | `workspace_id` (PK), `channel_id` (unique), `channel_title`, `refresh_token_enc` (AES-GCM, workspace ID as AAD), `scopes`, `connected_at`, `refreshed_at` | Members read metadata; the ciphertext only through `app.youtube_refresh_token()`; writes only through `app.save_youtube_connection()` (owner); the owner deletes on disconnect |

## Policies (`app_runtime`)

| Table | Select | Insert | Update | Delete |
| --- | --- | --- | --- | --- |
| `member` (`id`, `display_name` only) | Yourself; people in the current workspace if you belong to it | Only via `app.upsert_member` | Your own `display_name` | None yet (ET-5 account deletion) |
| `workspace` | Workspaces you belong to | Only via `app.create_workspace` | `name`, owner of the current workspace | None yet |
| `workspace_member` | Your own memberships; all of the current workspace if you belong to it | None: moderators join by accepting an invite through a definer function (ET-9) | None | A moderator row in the current workspace, by its owner or by the moderator leaving |

Nobody can add a membership by plain SQL, so an owner can't attach someone without their consent, and nobody can create a second owner. Moderators join only through `accept_invite()` (ET-9). There's no email provider ($0): the owner sends the invite link themselves. Policies call `role_in` as `(SELECT app.role_in(app.current_workspace_id()))` so it runs once per query, not once per row.

## Functions

| Function | Security | Notes |
| --- | --- | --- |
| `app.current_member_id()`, `app.current_workspace_id()` | Invoker | Read the transaction settings |
| `app.role_in(workspace)` | Definer | Avoids policy recursion on `workspace_member` |
| `app.upsert_member(sub, email, name)` | Definer | Called by the Worker only after it verifies a Google ID token (ET-5) |
| `app.create_workspace(name)` | Definer | Needs a member context; makes the caller its owner |
| `app.me()` | Definer | Your own id, email and display name |
| `app.workspace_members()` | Definer | Members of the current workspace; `email` only for the owner, or for your own row |
| `app.create_session(member, hash, ttl)`, `app.session_member(hash, idle)`, `app.delete_session(hash)` | Definer | Hex-encoded hashes; `session_member` slides `last_seen_at` |
| `app.save_youtube_connection(...)` | Definer | Owner of the current workspace only |
| `app.youtube_refresh_token()` | Definer | Hex ciphertext for any member of the current workspace (LiveSession needs it) |
| `app.delete_my_account()` | Definer | Deletes the caller's owned workspaces (cascading YouTube data) and the caller |

All use `SET search_path = pg_catalog` and fully qualified names. `EXECUTE` is revoked from `PUBLIC`. `upsert_member` overwrites email and name for a Google subject, so only call it after verifying the ID token.

The migration refuses to run if `app_runtime` or `app_definer` already exists with `BYPASSRLS`, `SUPERUSER` or `LOGIN`. The migrator takes an advisory lock and applies each file in one transaction, so a migration can't use `CREATE INDEX CONCURRENTLY` or its own `BEGIN`/`COMMIT`.

## Testing

`packages/db/test` applies the migrations as a non-superuser CREATEROLE role, the way Neon's owner works; running as superuser hid a privilege bug once. It then builds a synthetic world on PGlite (alice owns A with bob as moderator, carol owns B, dave belongs nowhere). It checks that every `app` table has RLS enabled and forced, that runtime roles can't bypass it, and that reads, writes and inserts can't cross workspaces or roles. The suite was mutation-checked: weakening the select policies fails it. Add a table with the `new-workspace-table` skill.

## Retention

Disconnect revokes the Google token, then deletes the connection row straight away (non-negotiable 3 allows up to 7 days). Account deletion revokes, then deletes owned workspaces, memberships and sessions. `app.purge_expired()` runs on every sign-in (and from the daily cron once ET-8 adds it). It deletes expired and idle sessions, and members with no workspace and no live session 30 days after their last sign-in. If the token can't be decrypted (lost or rotated key), disconnect and account deletion still delete the row and log `token_undecryptable`. Ciphertexts start with a key-version byte so the key can be rotated. ET-8 adds seasons and viewer counters with their retention cron (ADR-006), plus a refresh-or-delete job for channel metadata older than 30 days.
