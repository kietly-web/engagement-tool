# ADR-001 Cloudflare Workers with one Durable Object per live session

Status: Accepted · 2026-11-08

## Context

A live session must poll YouTube chat every few seconds for hours, keep votes and points in memory, and push changes to OBS overlays over WebSockets (FR-03, FR-04, NFR-PERF). It must cost $0 (NFR-COST, ADR-005) and fit a solo developer. Beta scale is 5–20 creators.

## Decision

- One TypeScript pnpm monorepo: `packages/core`, `packages/youtube`, `packages/db`, `apps/worker`, `apps/web`, `apps/overlay` (rules in CLAUDE.md).
- `apps/worker` is a Hono app on Cloudflare Workers (free plan). It serves the API, Google sign-in, the dashboard and overlay static assets, and cron jobs.
- A `LiveSession` Durable Object (SQLite-backed, the kind the free plan allows) per workspace live session. Its ID is `idFromName(workspaceId + ":" + broadcastId)`, computed on the server only. It polls chat with alarms, applies `packages/core` rules, persists running state in its own storage and fans out to overlays with hibernatable WebSockets.
- Deploys through Cloudflare Workers Builds (Git integration), so no Cloudflare API token is stored in GitHub. Preview URLs per branch.

## Consequences

- Live state survives restarts in Durable Object storage (NFR-REL); Postgres is written in batches, not per chat message.
- Free-plan daily caps on requests and Durable Object duration bound concurrency (Q-T3, R6). Each slice that adds load states its estimate (CLAUDE.md "Watch the free limits").
- Worker CPU is limited per request on the free plan; parsing stays cheap and pure.
- Local dev with `wrangler dev` runs Durable Objects in Miniflare.

## Alternatives considered

- Node server on a free VM (Fly, Render, Oracle): free tiers sleep, change terms or need a card; long-lived pollers need always-on hosts.
- Vercel or Netlify functions: no long-lived connections or durable per-stream state; would need a separate realtime service.
- OBS plugin or desktop app: see ADR-007.
