---
name: new-workspace-table
description: Add a Postgres table that belongs to a creator's workspace, with forced row-level security, role policies, a backward-compatible migration and cross-workspace isolation tests. Use whenever a slice adds or splits a table holding workspace data in packages/db.
---

# Add a workspace table

Non-negotiable 4, ADR-002 and `docs/design/02-data-model.md` apply.

1. **Shape.** In schema `app`: `workspace_id uuid NOT NULL REFERENCES app.workspace (id) ON DELETE CASCADE`, indexed. Store only fields the data inventory allows; for viewers that is channel ID and counters only (non-negotiable 2). Add `CHECK` limits on text lengths.
2. **Migration.** New file `packages/db/migrations/NNNN_short_name.sql` (next number; never edit an applied file, the migrator refuses). Expand only: create table, indexes, then `ALTER TABLE … ENABLE ROW LEVEL SECURITY;` and `… FORCE ROW LEVEL SECURITY;`.
3. **Grants.** Only what the app needs to `app_runtime`, column-level for `UPDATE`. If a definer function touches the table, grant `app_definer` too and add `CREATE POLICY definer_all ON app.x TO app_definer USING (true) WITH CHECK (true);`.
4. **Policies (`TO app_runtime`).** One per command. Reads: `workspace_id = app.current_workspace_id() AND app.role_in(workspace_id) IS NOT NULL`. Owner-only writes: `… AND app.role_in(workspace_id) = 'owner'`, in both `USING` and `WITH CHECK`. Never trust a role passed by the app.
5. **Repository.** Add functions in `packages/db/src/repositories.ts` that take a `Queryable` and use `app.current_workspace_id()` rather than a workspace parameter. Callers use `withWorkspace`; nothing outside `packages/db` imports the driver.
6. **Tests (PGlite).** Extend `packages/db/test/fixtures.ts` with rows in both workspaces and add cases in `isolation.test.ts`: as alice in A you can't select, update or delete B's rows; inserting with B's `workspace_id` fails; pointing the context at B shows nothing; no context shows nothing; the moderator can't do owner-only writes. The "forces row-level security on every table" test covers the new table automatically. Weaken one policy locally and confirm a test fails.
7. **Retention.** If the table holds YouTube-derived or viewer data, add it to the daily retention cron and the disconnect deletion, with a test (ADR-006).
8. **Paperwork.** Update `docs/design/02-data-model.md` and `docs/compliance/data-inventory.md`; run the security review.
