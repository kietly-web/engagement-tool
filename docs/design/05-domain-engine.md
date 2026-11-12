# 05 Domain engine

Pure rules in `packages/core`: no I/O, no imports from other packages, time from an injected `Clock`. Written by ET-3; ET-8 adds points and seasons, ET-10 adds games.

## Text handling

| Function | Use | Never use for |
| --- | --- | --- |
| `toNfc(text)` | Anything shown or stored (poll questions and options, display names on overlays) | — |
| `commandKey(text)` | Matching commands only | Display or storage: folding merges words ("chọn" and "chôn" both become "chon") |

`commandKey` takes the first 256 UTF-16 units (YouTube caps chat at 200 characters), applies NFKC (then caps again, since NFKC can expand a character to 18) (full-width letters, digits, punctuation and the ideographic space become ASCII), drops format characters (`\p{Cf}`: zero-width and bidi controls), removes combining marks and maps `đ`→`d`, lower-cases and collapses whitespace. The cap bounds the work for hostile input, whatever its length.

## Commands (FR-04, FR-08)

A command must be the first thing in the message and start with `!` (full-width `！` works too).

| Command | Aliases (with or without diacritics, any case) | Argument | Result |
| --- | --- | --- | --- |
| Vote | `!vote`, `!v`, `!bình chọn`, `!binhchon`, `!chọn`, `!bc` | 1–2 digits after NFKC (ASCII, full-width, superscript, mathematical), optional space before | `{ kind: "vote", option }` with option ≥ 1 |
| Join | `!join`, `!tham gia`, `!thamgia`, `!tg` | Anything after a space is ignored | `{ kind: "join" }` |

Everything else returns `null` and costs one bounded normalisation and two anchored regex tests. Specifics:

- The argument must end at a space or the end of the message: `!vote 2.5`, `!vote 2abc` and `!vote 123` are ignored.
- Other scripts' digits (`٢`) and number words (`hai`) are ignored rather than guessed.
- Look-alike letters from other scripts (Cyrillic `о` in `!vоte`) don't match.
- Zero-width characters, bidi controls and zalgo marks inside a command are stripped, so the vote still counts. That is harmless, and the overlay never shows the raw text anyway.
- Circled, superscript and mathematical digits fold under NFKC (`①`, `²`, `𝟐`). Accepted.
- Folding collisions are accepted: `!chôn 2` counts as a vote.
- `COMMAND_ALIASES` lists the forms for the dashboard help text.

## Polls (FR-04, US-04)

- 2–6 options; question ≤ 120 characters and options ≤ 40, counted in code points after NFC and whitespace collapsing. Options must differ case-insensitively.
- Lifecycle `draft → open → closed`, timestamps from the clock. Any other transition throws `PollError("invalid_transition")`.
- One counted vote per viewer channel ID. Vote-change policy `first` (default: the first valid vote stands) or `latest` (viewers may switch). Outcomes: `counted`, `changed`, `duplicate`, `invalid_option`, `invalid_viewer`, `not_open`. Nothing throws on viewer input.
- Viewer IDs must look like a channel ID (`UC` + 22 of `[A-Za-z0-9_-]`); anything else is rejected before it touches state.
- `results()` returns counts per option and the total number of voters. That is all an overlay receives.
- `snapshot()` / `Poll.restore()` let the `LiveSession` Durable Object persist a poll. Restore rejects a snapshot with an unknown status or policy, unparseable times, or times that don't match the status (`PollError("corrupt_snapshot")`). It skips vote entries that are duplicated, non-string or out of range rather than miscounting. It does not re-apply text limits, so tightening them later can't break a poll that is open mid-stream.

### Viewer data

The poll's channel-ID → option map links a viewer to a choice, so it lives only in Durable Object memory and storage while the poll is open (data inventory row "Viewer's choice in an open poll"). `close()` returns the voter IDs once and clears the map; only the counts survive. A closed poll's snapshot holds its validated counts and no viewer IDs. ET-6 caught a bug here: restoring a closed poll used to rebuild counts from the cleared map and reset them to zero. From ET-8 the session awards participation points from that returned list, server-side only. Voter IDs never go into an overlay payload. Chat text never enters the poll.

## Synthetic chat

`syntheticChat({ seed, count, viewers, options, adversarial })` makes deterministic chat for tests and demos (non-negotiable 8).

- Each message carries an `intent` (the command it should parse to, or `null`). The test suite checks every generated message against `parseCommand`, adversarial ones included.
- Viewer IDs are valid channel IDs prefixed `UCSYNTH`, so synthetic data is recognisable anywhere it appears.
- The adversarial mix covers HTML and script tags, bidi overrides, zero-width joiners, zalgo, Cyrillic look-alikes, Arabic-Indic digits, 5,000-character messages, huge numbers and URLs.

## Points and seasons (ET-8)

- `!join` (or `!tham gia`, `!tg`) earns 10 points once per live session; each counted vote earns 5. No points for chatting, no other way to earn, and nothing to redeem (non-negotiable 6).
- `PointsTally` holds per-viewer deltas between flushes: channel ID and counters only. A flush takes the pending deltas as one batch with an ID, saves it, and sends it. The database records batch IDs, so a retry after a lost response or an eviction is applied once, and the top-10 read runs in the same transaction. The engine flushes about every 10 s and at stop, as the member who started the session. Failures back off up to 5 minutes; after 5 failures, or when the season's end passes, the session stops writing points.
- Erasing a viewer waits for any flush in flight, removes them from pending and in-flight deltas, and blocks further credit for the session. Only then does the route delete their rows.
- Seasons last 1 to 29 days (`seasonWindow`), one at a time per workspace. Without a running season, or in demo mode, points live only in session memory as a preview leaderboard.
- The leaderboard shows the top 10 with display names only for viewers seen in the current session; others show as "Khán giả". Channel IDs never reach an overlay.

## Custom command alerts (ET-14)

- The owner defines up to 20 commands in the alerts widget config: a trigger (letters and digits, folded like built-ins, never shadowing `!vote`, `!join` and the others), their own text (≤ 80 characters, NFC, controls stripped), a sticker from a fixed set and an animation from a fixed set.
- In the session engine, a message that isn't a built-in command is matched against the triggers. An alert fires only if both cooldowns allow it: per viewer (5–600 s, default 30) and between any two alerts (1–60 s, default 3). Alerts earn no points.
- An alert event is generic (`source`: `command`, `test`, later `super_chat`, `membership`), carries the creator's text, the viewer's session-memory display name (removed for widgets that hide names) and the sticker and animation keys. It is pushed straight to alerts sockets and never stored. The overlay plays at most 10 queued alerts, about 4.5 s each, then shows a "commands you can type" hint if enabled (Q-P1).

## Donation alerts (ET-17, ADR-008)

- The YouTube reader maps `superChatEvent`, `superStickerEvent`, `newSponsorEvent` and `membershipGiftingEvent` to chat messages with empty text and a `donation` field (kind, YouTube's amount string, comment). They never reach the command parser, so a paid message can't vote, join or earn points.
- `donationAlert()` turns them into alerts per the owner's switches (Super Chats, memberships, show amount, show comment). No cooldown applies; the overlay queue (10) bounds bursts. Nothing is stored. An erased viewer's donation still shows, without their name.
- Demo mode emits a synthetic Super Chat or membership every few pages.

## Not yet

Games (ET-10); configurable aliases per workspace (backlog idea).
