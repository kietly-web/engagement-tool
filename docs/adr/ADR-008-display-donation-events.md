# ADR-008 Display donation events read-only; the tool never handles money

Status: Accepted · 2026-11-10

## Context

At kickoff the owner chose "free and no payments" and declined reading Super Chats. On 10/11/2026 the owner changed this: phase 2 should show donations as overlay animations, starting with YouTube Super Chats, and later the donation services Vietnamese streamers use. This changes the fixed decision "No payments and nothing of monetary value" (discovery Q-P3). Risks R3 (children's data) and R8 (gambling/promotion rules) apply.

Vietnamese streamers commonly take donations through bank-transfer QR services with their own OBS alerts. Examples seen in November 2026: Tipme, ZyPage, Zentnow (via SePay), TipMe (VietQR), WeScan (VNPay QR), plus older portals such as PlayerDuo and Unghotoi. None was verified in depth, and "ezpay" wasn't found.

## Decision

- The tool **never receives, holds, moves or settles money**, and never asks viewers to pay. It only displays donation events that happened elsewhere.
- **Phase 2 (ET-17): YouTube only.** Super Chats, Super Stickers and new or gifted memberships, read from the same `youtube.readonly` chat stream (no new scope, no extra quota), shown on an alerts widget with the donor's display name, YouTube's amount string and the comment as text only.
- **Donations earn no points** and have no effect on games or leaderboards, so points stay unbuyable (non-negotiable 6).
- Donation events are not stored in Postgres or logs. Donor name, amount and comment live in session memory only, like display names (non-negotiable 2), and only the counts of events per session may be kept.
- **Later: third-party Vietnamese donation services.** Each one needs its own ADR before code. The ADR must cover how events arrive (webhook or API), signature verification, a sub-processor entry, the data stored, and whether that service's terms allow it. The tool still never touches the money.

## Consequences

- `toChatMessage` must stop dropping `superChatEvent`, `superStickerEvent`, `newSponsorEvent` and `membershipGiftingEvent`, and map them to a separate donation event type that never reaches the command parser.
- Data inventory gains a row for donation events (session memory only). Amount strings may reveal a child's spending; showing them is the creator's choice per widget (on by default, can be hidden).
- Some creators may already run a third-party OBS alert; ours must not double-show YouTube events they already display elsewhere (setting per widget).

## Alternatives considered

- Taking donations through the tool (bank QR, e-wallets): brings payment-intermediary rules, fees (breaks $0), anti-fraud duties and children paying money. Rejected.
- Rewarding donors with points: makes points purchasable, which breaks non-negotiable 6 and likely VN promotion rules. Rejected.
