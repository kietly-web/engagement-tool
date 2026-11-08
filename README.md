# engagement-tool

A free live-stream engagement tool for Vietnamese YouTubers and VTubers. Viewers type commands in YouTube live chat (`!vote 2`, `!join`), and polls, mini-games and seasonal loyalty points appear on OBS overlays. Read-only on YouTube; viewers never sign in.

Start with [CLAUDE.md](CLAUDE.md) (rules), then [docs/STATUS.md](docs/STATUS.md) (where we are) and [docs/SETUP.md](docs/SETUP.md) (what's not done).

## Folder map

```text
engagement-tool/
├── README.md            What the project is and how the folders fit together
├── CLAUDE.md            Rules for anyone changing the code
├── packages/
│   ├── core/            Pure domain logic: commands, polls, points, seasons (no I/O)
│   ├── youtube/         The only code that calls YouTube; read-only ChatSource
│   └── db/              The only code that talks to Postgres; RLS context
├── apps/
│   ├── worker/          Cloudflare Worker (Hono): API, sign-in, LiveSession, cron
│   ├── web/             Dashboard (Vite + React), Vietnamese first
│   └── overlay/         OBS overlay pages, text-only rendering
├── scripts/             CI helper scripts
├── docs/                Everything written down (index: CLAUDE.md "Where things are")
│   ├── STATUS.md        Current stage and next slice
│   ├── SETUP.md         Everything not done yet
│   ├── discovery/       Requirement, story, metric and risk IDs
│   ├── compliance/      Personal-data inventory and compliance drafts
│   ├── runbooks/        Backups, rollback, alerts, incidents
│   ├── design/          Design pack
│   └── adr/             Decision records
├── .github/             CI, PR template, dependency updates
└── .claude/             Project reviewer (agent) and workflows (skills)
```

## Run it

```bash
pnpm install
pnpm build
pnpm --filter @et/worker dev
```

Then open http://localhost:8787. `pnpm dev` runs the Vite dev servers too (dashboard on 5173, proxying `/api` to the Worker). Run `pnpm check` before every push.

## Pages

| Path | What |
| --- | --- |
| `/` | Dashboard (placeholder with server status) |
| `/healthz` | Health check used by the smoke test |
| `/overlay/` | Overlay placeholder; real widgets move to `/o/<token>/<widget>` in ET-7 |

Planned: `/privacy`, `/terms` (ET-11).
