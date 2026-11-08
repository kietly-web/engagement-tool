# 05 Domain engine

Pure rules in `packages/core`: no I/O, no imports from other packages, time from an injected `Clock`. Written by ET-3; ET-8 adds points and seasons, ET-10 adds games.

## Text handling

| Function | Use | Never use for |
| --- | --- | --- |
| `toNfc(text)` | Anything shown or stored (poll questions and options, display names on overlays) | — |
| `commandKey(text)` | Matching commands only | Display or storage: folding merges words ("chọn" and "chôn" both become "chon") |

`commandKey` takes the first 256 UTF-16 units (YouTube caps chat at 200 characters), applies NFKC (full-width letters, digits, punctuation and the ideographic space become ASCII), drops format characters (`\p{Cf}`: zero-width and bidi controls), removes combining marks and maps `đ`→`d`, lower-cases and collapses whitespace. The cap bounds the work for hostile input, whatever its length.

## Commands (FR-04, FR-08)

A command must be the first thing in the message and start with `!` (full-width `！` works too).

| Command | Aliases (with or without diacritics, any case) | Argument | Result |
| --- | --- | --- | --- |
| Vote | `!vote`, `!v`, `!bình chọn`, `!binhchon`, `!chọn`, `!bc` | 1–2 ASCII or full-width digits, optional space before | `{ kind: "vote", option }` with option ≥ 1 |
| Join | `!join`, `!tham gia`, `!thamgia`, `!tg` | Anything after a space is ignored | `{ kind: "join" }` |

Everything else returns `null` and costs one bounded normalisation and two anchored regex tests. Specifics:

- The argument must end at a space or the end of the message: `!vote 2.5`, `!vote 2abc` and `!vote 123` are ignored.
- Other scripts' digits (`٢`) and number words (`hai`) are ignored rather than guessed.
- Look-alike letters from other scripts (Cyrillic `о` in `!vоte`) don't match.
- Zero-width characters, bidi controls and zalgo marks inside a command are stripped, so the vote still counts. That is harmless, and the overlay never shows the raw text anyway.
- Circled or other compatibility digits fold under NFKC (`①` → `1`). Accepted.
- Folding collisions are accepted: `!chôn 2` counts as a vote.
- `COMMAND_ALIASES` lists the forms for the dashboard help text.

## Polls (FR-04, US-04)

- 2–6 options; question ≤ 120 characters and options ≤ 40, counted in code points after NFC and whitespace collapsing. Options must differ case-insensitively.
- Lifecycle `draft → open → closed`, timestamps from the clock. Any other transition throws `PollError("invalid_transition")`.
- One counted vote per viewer channel ID. Vote-change policy `first` (default: the first valid vote stands) or `latest` (viewers may switch). Outcomes: `counted`, `changed`, `duplicate`, `invalid_option`, `invalid_viewer`, `not_open`. Nothing throws on viewer input.
- Viewer IDs must look like a channel ID (`UC` + 22 of `[A-Za-z0-9_-]`); anything else is rejected before it touches state.
- `results()` returns counts per option and the total number of voters. That is all an overlay receives.
- `snapshot()` / `Poll.restore()` let the `LiveSession` Durable Object persist an open poll. Restore re-validates every entry and skips duplicates or corrupt rows rather than miscounting.

### Viewer data

The poll's channel-ID → option map lives only in Durable Object memory and storage while the poll exists (ADR-006, data inventory row "Viewer YouTube channel ID"). When a poll closes, the session keeps the counts and, from ET-8, awards participation points by channel ID. Then it drops the map. Chat text never enters the poll.

## Synthetic chat

`syntheticChat({ seed, count, viewers, options, adversarial })` makes deterministic chat for tests and demos (non-negotiable 8).

- Each message carries an `intent` (the command it should parse to, or `null`). The test suite checks every generated message against `parseCommand`, adversarial ones included.
- Viewer IDs are valid channel IDs prefixed `UCSYNTH`, so synthetic data is recognisable anywhere it appears.
- The adversarial mix covers HTML and script tags, bidi overrides, zero-width joiners, zalgo, Cyrillic look-alikes, Arabic-Indic digits, 5,000-character messages, huge numbers and URLs.

## Not yet

Points, seasons and leaderboards (ET-8); games (ET-10); configurable aliases per workspace (backlog idea).
