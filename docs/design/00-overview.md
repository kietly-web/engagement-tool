# 00 Overview and principles

## What it is

Viewers type commands in a creator's YouTube live chat (`!vote 2`, `!join`). The tool reads that chat read-only, runs polls, mini-games and seasonal loyalty points, and draws the results on overlays the creator adds to OBS as a Browser Source. Creators and moderators use a Vietnamese web dashboard. Viewers never visit the site. Requirement IDs are in [discovery-summary.md](../discovery/discovery-summary.md).

## Principles

1. **Viewers are possibly children and never our users.** We hold as little about them as the feature needs, and nothing that outlives a season (ADR-006).
2. **Read-only on YouTube.** Results reach viewers through the stream, never through writes to YouTube (ADR-004, ADR-007).
3. **Points are play.** No money, prizes or transfers, ever (R8).
4. **Fail closed, not billed.** A limit hit stops a session with a reason; it never creates a cost (ADR-005).
5. **The database enforces tenancy.** App code is the second line, not the first (ADR-002).
6. **Pure core.** Command parsing and game rules are pure functions with an injected clock, tested with synthetic chat.
7. **Vietnamese first.** Normalise to NFC, match commands with and without diacritics, keep every string in a catalog.

## Design pack

| Section | State |
| --- | --- |
| [01 Architecture](01-architecture.md) | Written at kickoff |
| 02 Data model | Written by ET-4 (first migration) |
| [03 Security and privacy](03-security-privacy.md) | Written at kickoff |
| [05 Domain engine](05-domain-engine.md) (commands, polls; points and games later) | Written by ET-3 |
| [07 Infrastructure](07-infrastructure.md) | Written at kickoff |
| [08 Delivery plan](08-delivery-plan.md) | Written at kickoff |

No data-import (04) or AI (06) sections: neither exists at launch.
