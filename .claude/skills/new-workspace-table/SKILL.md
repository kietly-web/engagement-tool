---
name: new-workspace-table
description: Add a Postgres table that belongs to a creator's workspace, with forced row-level security, role policies, a backward-compatible migration and cross-workspace isolation tests. Use whenever a slice adds or splits a table holding workspace data in packages/db.
---

# Add a workspace table

Non-negotiable 4 and ADR-002 apply. Refine these steps in ET-4 once the migration tooling exists.

1. **Shape.** Add `workspace_id uuid not null references workspace(id) on delete cascade` and index it. Store only fields the data inventory allows; for viewers that is channel ID and counters only (non-negotiable 2).
2. **Migration (expand only).** In this order, one statement per chunk: create table; indexes; `alter table … enable row level security`; `alter table … force row level security`; `grant` only the needed privileges to `app_runtime`; one policy per command and role, each reading `current_setting('app.workspace_id', true)::uuid` and, where roles differ, `current_setting('app.member_role', true)`. Read the generated SQL and reorder by hand if needed.
3. **Repository.** Add it to `packages/db`; every method runs inside `withWorkspace`. Nothing outside `packages/db` imports the driver.
4. **Isolation tests (PGlite).** Seed two workspaces with synthetic rows. As `app_runtime` in workspace A: cannot select, update or delete B's rows; insert with B's `workspace_id` fails; with no workspace context set, sees nothing. Repeat for the moderator role where its rights differ.
5. **Retention.** If the table holds YouTube-derived or viewer data, add it to the daily retention cron and the disconnect deletion, with a test (ADR-006).
6. **Paperwork.** Update `docs/design/02-data-model.md` and `docs/compliance/data-inventory.md`; run `security-compliance-reviewer`.
