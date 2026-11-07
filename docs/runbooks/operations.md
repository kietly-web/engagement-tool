# Operations runbook

What to do when production needs care. Keep it short and true; every "not yet" has a row in [SETUP.md](../SETUP.md).

## Backups and restore

| Store | Backup | Retention | Last restore test |
| --- | --- | --- | --- |
| Supabase Postgres (Singapore, free) | Supabase daily backups on free are limited; plus a weekly `pg_dump` by the owner to an encrypted local file (no personal data leaves the owner's machine) | Keep 4 weekly dumps; delete older | not yet |
| Durable Object storage | None; it holds only live session state that is flushed to Postgres | Session lifetime | n/a |

Restore steps: create a new Supabase project (or a local Postgres), `pg_restore` the dump there first, verify row counts and RLS, then repoint `DATABASE_URL` with `wrangler secret put`. Never restore over production directly.

Restoring brings back viewer rows from ended seasons and disconnected workspaces: run the retention cron by hand straight after (ADR-006).

## Rollback

- **Code:** Cloudflare dashboard → Workers & Pages → the Worker → Deployments → previous version → Rollback (or `wrangler rollback`). Safe because migrations are expand-then-contract.
- **Migration:** never roll back a contract step with data loss; ship a forward fix. The owner decides.

## Monitoring and alerts

| Signal | Tool | Alert goes to | Threshold |
| --- | --- | --- | --- |
| Server errors | Workers Logs (free) | Owner checks during beta | New error codes after a deploy |
| Site down or headers missing | `smoke.yml` (schedule + manual) | Owner via GitHub failed-workflow email | One failed run |
| Retention cron didn't run | Heartbeat row checked by smoke test | Owner via GitHub email | No heartbeat for 36 hours |
| Spend | None needed: no billing on any account (ADR-005) | — | — |
| YouTube quota | Quota ledger; Google Cloud → APIs → Quotas | Dashboard banner | 80% of daily budget |

Logs and error reports carry no personal data, chat text or overlay tokens.

## Common fixes

- **Supabase paused:** Supabase dashboard → project → Restore. Then check the daily cron is running.
- **Creator's sessions won't start, "reconnect Google":** Testing-mode refresh token expired after 7 days (R4); creator reconnects from settings.
- **Overlay URL leaked:** creator rotates it in the dashboard; old sockets close at once.

## Incident response

1. Stabilise: roll back, or stop all sessions by setting the `SESSIONS_DISABLED` var to `true` and redeploying (added in ET-6).
2. Record in a private note (not a public issue; the repo is public): time found, impact, actions with timestamps.
3. Fix forward with a slice PR; add the lesson to `docs/STATUS.md` gotchas.

## Personal-data breach

| Law | Notify whom | Deadline |
| --- | --- | --- |
| VN PDPL (Law 91/2025/QH15) and Decree 356/2025/ND-CP | Ministry of Public Security (A05) and affected creators; viewers via creators where identifiable | 72 hours from awareness, to be confirmed by counsel |
| Google API / YouTube API Terms | Google, if Google user data is involved | Promptly, per Google's terms |

Contacts: owner (kietly-web); counsel to be named before launch (SETUP §7); Cloudflare and Supabase support through their dashboards.
