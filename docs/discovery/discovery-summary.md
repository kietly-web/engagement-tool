# Discovery summary (source of truth for IDs)

IDs are stable: add new ones, never renumber. Code, tests, PRs and docs cite them.

## Product in one line

A free engagement tool for Vietnamese YouTubers and VTubers: viewers type commands in YouTube live chat, and polls, mini-games and seasonal loyalty points appear on the creator's OBS overlay within seconds.

## Personas

| Persona | Scope | Profile |
| --- | --- | --- |
| P1 Creator | Owns a workspace; signs in with Google; connects one YouTube channel | Vietnamese YouTuber or VTuber streaming games, chatting or singing; uses OBS or Streamlabs; not technical; 5–20 in the beta |
| P2 Moderator | Invited into a creator's workspace; runs polls and games during streams | Trusted fan or friend of the creator; signs in with Google |
| P3 Viewer | Types commands in YouTube chat; never visits the site or signs in | Any age, possibly a child (treated as one); sees results in the stream |
| P4 Operator | The owner running the service | Solo developer; handles incidents, deletion and rights requests |

## Fixed decisions

- YouTube only at launch; other platforms later, behind the `ChatSource` adapter.
- Read-only on YouTube (`youtube.readonly`); the tool never posts, deletes or moderates (ADR-004).
- Results show only on OBS browser-source overlays and the dashboard (ADR-007).
- No AI at launch; an AI slice later needs its own ADR.
- No payments and nothing of monetary value; points are for fun only (R8).
- $0 running cost on free plans that fail closed (ADR-005).
- Cloudflare Workers + Durable Objects, Neon Postgres in Singapore, TypeScript (ADR-001, ADR-002).
- Google sign-in for creators and moderators (ADR-003). Viewers never sign in.
- UI Vietnamese first, English later; docs and code in English.

## Functional requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-01 | A creator signs in with Google, grants read-only YouTube access, and gets one workspace bound to their channel | Must |
| FR-02 | A creator invites moderators by email and removes them; a moderator can run sessions, polls and games but cannot change workspace settings, tokens or members | Must |
| FR-03 | A creator or moderator starts a live session for the channel's current live broadcast and stops it; the session reads chat until stopped, the broadcast ends or quota runs out | Must |
| FR-04 | Polls: create with 2–6 options, open, close; viewers vote with `!vote N` (one counted vote per viewer channel); live counts on the overlay | Must |
| FR-05 | Overlays: one URL per widget with a secret token, transparent background, sized for 1920×1080; the creator can rotate a token, which disconnects the old URL at once | Must |
| FR-06 | Loyalty points per workspace: earned for participation (`!join`, voting, game wins) within a season of at most 30 days; leaderboard overlay | Must |
| FR-07 | Mini-games played through chat commands, rewarded with points only (first game chosen in ET-10) | Should |
| FR-08 | Commands match with and without Vietnamese diacritics; built-in Vietnamese aliases (for example `!binhchon 2` for `!vote 2`) | Must |
| FR-09 | Disconnect: the Google token is revoked at once and the workspace's YouTube-derived data is deleted within 7 days; the creator can delete the whole workspace | Must |
| FR-10 | Dashboard and overlays in Vietnamese; all copy in message catalogs so English can follow | Must |
| FR-11 | The dashboard shows the day's YouTube quota use and why a session stopped | Should |
| FR-12 | A creator can erase one viewer's counters by channel ID (for viewer rights requests) | Must |

## Non-functional requirements

| ID | Area | Target |
| --- | --- | --- |
| NFR-SEC | Security | OWASP ASVS L2 for the dashboard and API; RLS-enforced tenant isolation; secrets only in the Worker secret store |
| NFR-PRIV | Privacy | Minimum viewer data (CLAUDE.md non-negotiable 2); every personal-data field in `docs/compliance/data-inventory.md` |
| NFR-COST | Cost | $0 per month; every service on a free plan that stops instead of billing |
| NFR-QUOTA | YouTube quota | All workspaces together stay within the default 10,000 units/day; sessions stop cleanly before the limit |
| NFR-PERF | Latency | Overlay updates within 2 s of the Worker receiving a chat page (YouTube's own chat delay comes on top) |
| NFR-REL | Reliability | A session survives a Worker or Durable Object restart without losing counted votes or points |
| NFR-I18N | Language | Vietnamese first, English later; NFC normalisation everywhere text is compared |
| NFR-A11Y | Accessibility | Dashboard meets WCAG 2.2 AA basics (contrast, keyboard, labels) |

## User stories

| ID | Story | Key acceptance points |
| --- | --- | --- |
| US-01 | As a creator, I sign in with Google and connect my channel so the tool can read my live chat | Only `openid email profile youtube.readonly` requested; workspace created once; refusing YouTube access leaves no workspace |
| US-02 | As a creator, I copy an overlay URL into OBS and see a transparent widget | URL contains an unguessable token; wrong token returns 404 with no detail; works in OBS and Streamlabs browser sources |
| US-03 | As a creator or moderator, I start a session while live and stop it after | Start fails clearly if the channel isn't live; one session per workspace; stop is immediate |
| US-04 | As a viewer, I type `!vote 2` (or `!binhchon 2`, with or without diacritics) and see the count change on stream | One vote per channel ID; invalid option ignored; chat text never stored or logged |
| US-05 | As a creator, I run a season of points and show a leaderboard | Season ends at most 30 days after it starts; display names shown only during a live session; channel IDs never drawn on screen |
| US-06 | As a creator, I invite a moderator who runs polls for me | Moderator cannot see tokens, members or settings; cannot reach another workspace |
| US-07 | As a creator, I rotate a leaked overlay URL | Old URL stops updating within 5 s; new URL works without restarting the session |
| US-08 | As a creator, I disconnect and my data goes away | Google token revoked at once; YouTube-derived data deleted within 7 days; confirmation shown |
| US-09 | As a creator, I remove one viewer's data on request | Counters for that channel ID deleted in every season; action recorded in the audit log without the channel ID |

## Success metrics

| Metric | Target |
| --- | --- |
| Beta creators who run a poll on a real stream | 5 in the first month after M1 |
| Repeat use | 3 creators run sessions in 3 different weeks |
| Running cost | $0 every month |
| Overlay latency (Worker receipt to overlay paint) | p95 ≤ 2 s |
| Cross-workspace data incidents | 0 |

## Risks

L = likelihood, I = impact (H/M/L).

| ID | Risk | L | I | Mitigation |
| --- | --- | --- | --- | --- |
| R1 | One long stream, or several at once, burns the default 10,000-unit daily YouTube quota and every session stops | H | H | Quota accounting in `packages/youtube`; read chat with `streamList` (5 units per connection) instead of polling; per-workspace daily budget; fail closed with a clear dashboard message; apply for a quota extension before opening sign-up (Q-T1) |
| R2 | Per-viewer points count as derived data under YouTube API policy, or are kept too long, and API access is revoked | M | H | 30-day seasons; refresh-or-delete jobs; store only channel ID and counters; no cross-channel aggregation; Q-L3 to confirm |
| R3 | Viewer channel IDs are personal data of children under VN PDPL; processing without a lawful basis or parental consent | M | H | Minimum data (non-negotiable 2); no viewer accounts or profiling; erase-by-channel-ID tool; counsel on Q-L1 before open sign-up |
| R4 | Google OAuth: a sensitive scope needs app verification; in Testing mode refresh tokens expire after 7 days and only 100 test users are allowed | H | M | Request only `youtube.readonly`; beta creators as test users; re-consent flow handled cleanly; verification submitted before open sign-up |
| R5 | Chat text or a leaked overlay URL is used to show abuse on a creator's stream (HTML injection, offensive names, URL reuse) | M | H | Text-only rendering; length and character limits; per-widget rotatable tokens; overlays read-only; creator can hide names |
| R6 | Free-tier limits (Durable Object duration, Neon monthly compute, Workers daily requests) take the service down mid-stream | M | M | Fail closed and show the reason; keep live state in the Durable Object so a DB blip doesn't drop votes; uptime check; usage estimates per slice |
| R7 | One workspace reads or changes another's data, or a moderator exceeds their role | L | H | Forced RLS with a non-bypass app role; server-derived Durable Object IDs; isolation tests for every workspace table; reviewer on access-control slices |
| R8 | Points or games are treated as gambling or a prize promotion under VN rules | L | H | Non-negotiable 6; no prizes, purchases or transfers; game copy says points have no value; no "giveaway" features |

## Legal register (summary, not legal advice)

| Rule | In force | Design response |
| --- | --- | --- |
| VN Personal Data Protection Law, Law 91/2025/QH15 | 1 Jan 2026 | Minimum data, purpose limits, rights requests (FR-12, FR-09), breach runbook, data inventory |
| Decree 356/2025/ND-CP (PDPL guidance) | With the law | Children's data treated as needing parental consent, so we avoid collecting beyond channel ID and counters; cross-border transfer paperwork (Q-L2) |
| VN Cybersecurity Law and data-localisation rules | In force | Storage behind `packages/db` so the database can move; Q-L4 |
| VN rules on gambling, prize-winning games and commercial promotions | In force | Points have no value and no prizes (non-negotiable 6) |
| YouTube API Services Terms and Developer Policies | Current | Read-only scope; 30-day refresh-or-delete; revoke and delete on disconnect; privacy notice links Google's privacy policy; quota audit before scale |
| Google OAuth policies (sensitive scopes, verification) | Current | Minimum scopes; verification before open sign-up (R4) |

## Open questions

- Q-L1 What is our lawful basis for processing viewers' YouTube channel IDs (some may be children) without asking viewers, and are we controller or processor for it? (counsel)
- Q-L2 Does storing data in Singapore need a cross-border transfer impact assessment under the PDPL and Decree 356, and does any startup or small-business exemption apply? (counsel)
- Q-L3 May points seasons run longer than 30 days if channel IDs are refreshed, under YouTube Developer Policies III.E.4? (YouTube policy / counsel)
- Q-L4 Does any Vietnamese data-localisation requirement apply to a free service of this size? (counsel)
- Q-D1 How do viewers reach us or the creator to ask for erasure, and what deadline do we commit to? (owner)
- Q-T1 Does `liveChatMessages.streamList` work with `youtube.readonly` over HTTP from a Durable Object, how often does it reconnect, and what does a stream-hour cost? Spiked first in ET-6.
- Q-T2 Neon from Workers: Hyperdrive with a standard driver, or Neon's serverless driver over WebSockets, given RLS needs interactive transactions? **Decided in ET-4:** Hyperdrive + `pg`, caching disabled (ADR-002).
- Q-T3 How many concurrent sessions fit the Durable Objects free plan? Estimated in ET-6.
- Q-P1 Viewers can't get replies in chat (read-only). Should `!points` flash the viewer's score on an overlay ticker? (owner)
- Q-P2 Product name and domain. (owner)
