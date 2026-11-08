# ADR-001 Cloudflare Workers with one Durable Object per live session

Status: Accepted · 2026-11-08

## Context

A live session must poll YouTube chat every few seconds for hours, keep votes and points in memory, and push changes to OBS overlays over WebSockets (FR-03, FR-04, NFR-PERF). It must cost $0 (NFR-COST, ADR-005) and fit a solo developer. Beta scale is 5–20 creators.

## Decision

- One TypeScript pnpm monorepo: `packages/core`, `packages/youtube`, `packages/db`, `apps/worker`, `apps/web`, `apps/overlay` (rules in CLAUDE.md).
- `apps/worker` is a Hono app on Cloudflare Workers (free plan). It serves the API, Google sign-in, the dashboard and overlay static assets, and cron jobs.
- A `LiveSession` Durable Object (SQLite-backed, the kind the free plan allows) per workspace live session. Its ID is `idFromName("workspace:" + workspaceId)`, computed on the server only after a membership check. One object per workspace enforces one session at a time and lets overlays find the live session from the workspace alone; each start resets its state. It holds the chat stream open (ADR-004), applies `packages/core` rules, persists running state in its own storage and fans out to overlays with hibernatable WebSockets.
- Deploys through Cloudflare Workers Builds (Git integration), so no Cloudflare API token is stored in GitHub. Preview URLs per branch.

## Consequences

- Live state survives restarts in Durable Object storage (NFR-REL); Postgres is written in batches, not per chat message.
- Free-plan daily caps on requests and Durable Object duration bound concurrency (Q-T3, R6). Each slice that adds load states its estimate (CLAUDE.md "Watch the free limits").
- Worker CPU is limited per request on the free plan; parsing stays cheap and pure.
- Local dev with `wrangler dev` runs Durable Objects in Miniflare.

## Alternatives considered

- Node server on a free host (Render, Fly, Railway, Oracle): free tiers sleep after idle, are trial credits, or need a card; a stream reader needs an always-on process.
- Convex or Firebase: realtime built in, but no Postgres row-level security; Firebase needs the card-backed Blaze plan for outbound calls to YouTube.
- Deno Deploy: free and fast, but no durable per-stream actor to hold a chat connection and overlay sockets together.
- Vercel or Netlify functions: no long-lived connections or durable per-stream state; would need a separate realtime service.
- OBS plugin or desktop app: see ADR-007.
