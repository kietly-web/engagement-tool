# 02 Data model

Postgres (Neon, Singapore). Everything lives in schema `app`; migrations are plain SQL in `packages/db/migrations/NNNN_name.sql`, applied in order and recorded with a checksum in `public.schema_migrations`. Written by ET-4.

## Roles

| Role | Login | Purpose |
| --- | --- | --- |
| Owner (`neondb_owner` in Neon, `postgres` in tests) | Yes | Runs migrations and owns the tables. Never used by the Worker |
| `app_runtime` | No | Every app transaction runs as this role (`SET LOCAL ROLE app_runtime`). No `BYPASSRLS`, owns nothing, column-level grants only |
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

## Policies (`app_runtime`)

| Table | Select | Insert | Update | Delete |
| --- | --- | --- | --- | --- |
| `member` | Yourself; people in the current workspace if you belong to it | Only via `app.upsert_member` | Your own `display_name` | None yet (ET-5 account deletion) |
| `workspace` | Workspaces you belong to | Only via `app.create_workspace` | `name`, owner of the current workspace | None yet |
| `workspace_member` | Your own memberships; all of the current workspace if you belong to it | Owner of the current workspace adds a moderator | None | A moderator row in the current workspace, by its owner or by the moderator leaving |

Owners can't create another owner through SQL; ownership transfer would be its own function.

## Functions

| Function | Security | Notes |
| --- | --- | --- |
| `app.current_member_id()`, `app.current_workspace_id()` | Invoker | Read the transaction settings |
| `app.role_in(workspace)` | Definer | Avoids policy recursion on `workspace_member` |
| `app.upsert_member(sub, email, name)` | Definer | Called by the Worker only after it verifies a Google ID token (ET-5) |
| `app.create_workspace(name)` | Definer | Needs a member context; makes the caller its owner |

All use `SET search_path = pg_catalog` and fully qualified names. `EXECUTE` is revoked from `PUBLIC`.

## Testing

`packages/db/test` builds a synthetic world on PGlite (alice owns A with bob as moderator, carol owns B, dave belongs nowhere). It checks that every `app` table has RLS enabled and forced, that runtime roles can't bypass it, and that reads, writes and inserts can't cross workspaces or roles. The suite was mutation-checked: weakening the select policies fails it. Add a table with the `new-workspace-table` skill.

## Retention

Nothing YouTube-derived or viewer-related is stored yet. ET-5 adds the creator's channel and encrypted token; ET-8 adds seasons and viewer counters with their retention cron (ADR-006).
