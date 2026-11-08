# ADR-002 Neon Postgres in Singapore, isolation enforced by row-level security

Status: Accepted · 2026-11-08

## Context

Each creator's workspace is a tenant, with moderators inside it (FR-02). A cross-workspace leak is a trust and legal failure (R7, NFR-SEC). Data-localisation questions are open (Q-L2, Q-L4), so the store must be movable. Cost must be $0 (ADR-005), and a creator who streams once a week must never find the database asleep (R6).

## Decision

- Neon free plan, region AWS Asia Pacific (Singapore) `aws-ap-southeast-1`, the nearest region to Vietnam. One project for production; preview and dev use Neon branches seeded with synthetic data only (non-negotiable 8).
- Every workspace table has `workspace_id`, RLS enabled and forced, and policies per role. The Worker connects as `app_runtime`, a role that does not own tables and has no `BYPASSRLS`. Migrations run as the owner role from CI or the owner's machine, never from the Worker.
- Every query runs in a transaction that first sets `app.workspace_id` and `app.member_role` with `set_config(..., true)`; policies read those settings. Only `packages/db` touches the driver.
- Connection path is decided in ET-4 (Q-T2): Cloudflare Hyperdrive (free, 100,000 queries/day) with a standard Postgres driver, or Neon's serverless driver over WebSockets. Either must support interactive transactions for the RLS context.

## Consequences

- Free projects never pause; compute scales to zero after 5 minutes idle and wakes in a few hundred milliseconds. The `LiveSession` Durable Object buffers points and flushes in batches, so a cold start never drops a vote.
- 1 GB storage, 100 CU-hours per month (about 400 hours at the smallest compute size), 5 GB transfer, 6-hour point-in-time restore. Hitting a limit suspends compute until next month; data is kept. Viewer rows are tiny, so the beta fits easily.
- Isolation tests run against PGlite for every workspace table (CLAUDE.md testing rule); the `new-workspace-table` skill encodes the steps.
- Neon is a sub-processor (sub-processor register in `03-security-privacy.md`).

## Alternatives considered

- Supabase free: equally popular and also in Singapore, but free projects pause after 7 days without activity and need a manual restore, free has no automatic backups, and storage is 500 MB. We would use only its Postgres anyway.
- Cloudflare D1: free and close to Workers, but SQLite has no row-level security, so isolation would live only in app code.
- A Vietnamese cloud: no free tier that fails closed.
