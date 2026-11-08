# engagement-tool

A free live-stream engagement tool for Vietnamese YouTubers and VTubers. Viewers type commands in YouTube live chat (`!vote 2`, `!join`), and polls, mini-games and seasonal loyalty points appear on OBS overlays. Read-only on YouTube; viewers never sign in.

Start with [CLAUDE.md](CLAUDE.md) (rules), then [docs/STATUS.md](docs/STATUS.md) (where we are) and [docs/SETUP.md](docs/SETUP.md) (what's not done).

## Folder map

```text
engagement-tool/
├── README.md            What the project is and how the folders fit together
├── CLAUDE.md            Rules for anyone changing the code
├── packages/            (from ET-2) core, youtube, db
├── apps/                (from ET-2) worker, web (dashboard), overlay
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

## Pages

None yet. Planned: dashboard (`/`), overlays (`/o/<token>/<widget>`), privacy (`/privacy`), terms (`/terms`).
