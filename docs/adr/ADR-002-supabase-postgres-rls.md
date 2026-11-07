# ADR-002 Supabase Postgres in Singapore, isolation enforced by row-level security

Status: Accepted · 2026-11-08

## Context

Each creator's workspace is a tenant, with moderators inside it (FR-02). A cross-workspace leak is a trust and legal failure (R7, NFR-SEC). Data-localisation questions are open (Q-L2, Q-L4), so the store must be movable. Cost must be $0.

## Decision

- Supabase free plan, region Singapore (`ap-southeast-1`), nearest free region to Vietnam.
- Every workspace table has `workspace_id`, RLS enabled and forced, and policies per role. The Worker connects as `app_runtime`, a role that does not own tables and has no `BYPASSRLS`. Migrations run as a separate owner role from CI or the owner's machine, never from the Worker.
- Every query runs in a transaction that first sets `app.workspace_id` and `app.member_role` with `set_config(..., true)`; policies read those settings. Only `packages/db` touches the driver.
- We use Postgres only. Supabase Auth, Storage, Realtime and the auto-generated Data API are not used; the Data API is switched off so the anon key exposes nothing.
- Connection path (Hyperdrive or direct TCP to the transaction pooler) is decided in ET-4 (Q-T2).

## Consequences

- Isolation tests run against PGlite for every workspace table (CLAUDE.md testing rule); a `new-workspace-table` skill encodes the steps.
- Transaction-mode pooling forbids session-level `SET`; only transaction-local settings are used.
- Free projects pause after about a week without activity; the daily cron keeps it awake and the runbook covers unpausing (R6).
- 500 MB database limit; viewer rows are small (channel ID + counters), so the beta fits easily.

## Alternatives considered

- Cloudflare D1: free and close to Workers, but SQLite has no row-level security, so isolation would live only in app code.
- Neon: comparable free Postgres; Supabase chosen for the Singapore region and familiarity. Either works behind `packages/db`.
- A Vietnamese cloud: no free tier that fails closed.
