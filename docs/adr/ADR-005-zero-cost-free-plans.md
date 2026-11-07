# ADR-005 $0 by design: free plans that fail closed

Status: Accepted · 2026-11-08

## Context

The owner wants no financial pressure until there is traction (NFR-COST). A surprise bill is a bigger risk than a short outage at beta scale.

## Decision

- Only free plans that stop or error at their limits, with no payment method on file that could auto-upgrade: Cloudflare Workers free, Supabase free, Google Cloud project with no billing account, GitHub free (public repo).
- Each slice that adds load states its estimate against `docs/design/07-infrastructure.md`.
- Adding any paid plan or service needs a new ADR first.

## Consequences

- Hitting a limit is an outage, not a bill: sessions stop with a clear message and the uptime check alerts the owner (R6).
- Some features wait for traction: custom domain (optional, about $10/year, needs its own ADR), higher quotas, paid observability.
- The Google Cloud project must stay without a billing account; the YouTube Data API doesn't need one.

## Alternatives considered

- Paid hobby plans ($5/month Workers paid): more headroom, but contradicts the owner's goal until there is traction.
