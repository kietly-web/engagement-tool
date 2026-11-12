# First real run (ET-15)

The owner's first test of phase 1 on real Google, YouTube, Cloudflare and Neon. Expect some rework: none of this has run against the real services yet. Work through the parts in order; tick each box. Report anything that doesn't match to Claude with the step number.

No camera is needed. YouTube only needs a video signal: a still image, a colour background or a screen capture in OBS is enough. Chat works on any live stream.

## Part A: accounts (once, about 1 hour)

None of these needs a payment method. If any step asks for a card, stop and tell Claude (non-negotiable 7).

- [ ] A1 **YouTube live streaming enabled** on your channel: studio.youtube.com → Create → Go live. First-time channels need phone verification and can wait up to 24 hours, so do this first.
- [ ] A2 **Cloudflare account** (free): dash.cloudflare.com → Sign up. Then in a terminal in the repo: `npx wrangler login`.
- [ ] A3 **Workers Builds**: Cloudflare → Workers & Pages → Create → Import a repository → `kietly-web/engagement-tool`, using the build and deploy commands in [SETUP.md](../SETUP.md) §1. Let it deploy `main` once and note the URL, `https://engagement-tool.<your-subdomain>.workers.dev`. Opening it should show the dashboard saying the service isn't set up yet. That's expected.
- [ ] A4 **Neon** (free, region AWS Singapore): console.neon.tech → New project. Copy the owner connection string (direct, not pooled) into a password manager.
- [ ] A5 **Apply the database migrations** from the repo folder:
  ```bash
  DATABASE_OWNER_URL='<owner connection string>' pnpm --filter @et/db migrate
  ```
  It should print `Applied: 0001_tenancy.sql, …, 0006_widget_config.sql`.
- [ ] A6 **Worker database login**: Neon Console → SQL Editor, run the `CREATE ROLE app_worker …` statement from SETUP §1 with a password from `openssl rand -base64 32`. Then run the check query there; it must return `f, f, f`.
- [ ] A7 **Hyperdrive** (caching must be off):
  ```bash
  npx wrangler hyperdrive create engagement-tool-db --connection-string="postgres://app_worker:<password>@<neon-host>/neondb?sslmode=require" --caching-disabled
  ```
  Copy the printed ID.
- [ ] A8 **Google Cloud project** with no billing account: console.cloud.google.com → New project → APIs & Services → Library → enable "YouTube Data API v3".
- [ ] A9 **OAuth consent screen**: Google Auth Platform → External, status **Testing**. Add your own Google account (and any friend who'll help) as test users. Scopes: `openid`, `email`, `profile`, `youtube.readonly`.
- [ ] A10 **OAuth web client**: Google Auth Platform → Clients → Create → Web application. Redirect URI: `https://engagement-tool.<your-subdomain>.workers.dev/api/auth/google/callback`. Copy the client ID and secret.
- [ ] A11 **Secrets** (from the repo folder; paste each value when asked):
  ```bash
  pnpm --filter @et/worker exec wrangler secret put GOOGLE_CLIENT_SECRET
  ```
  ```bash
  pnpm --filter @et/worker exec wrangler secret put TOKEN_ENCRYPTION_KEY
  ```
  ```bash
  pnpm --filter @et/worker exec wrangler secret put SESSION_SECRET
  ```
  Generate the last two with `openssl rand -base64 32`. Keep them in a password manager too: losing `TOKEN_ENCRYPTION_KEY` means every creator must reconnect YouTube.

## Part B: send Claude three values (none is secret)

- [ ] B1 The Worker URL from A3.
- [ ] B2 The Hyperdrive ID from A7.
- [ ] B3 The Google client ID from A10.

Claude adds B2 and B3 to `apps/worker/wrangler.jsonc` in a small PR. When it merges, Workers Builds redeploys, and the dashboard shows the sign-in buttons.

## Part C: the test (about 1 hour)

**C1 Dashboard and demo mode (no stream needed)**

- [ ] Sign in with Google ("Đăng nhập với Google và kết nối kênh YouTube"). Allow the YouTube permission. You should land on your channel's workspace.
- [ ] Live panel → "Chạy thử với chat giả lập". Open a poll with 2–4 options. Counts should rise within a few seconds.
- [ ] Season panel → start a 1-day season ("Mùa thử"). In the demo, the leaderboard fills from fake viewers. Demo points are never saved.
- [ ] Style panel → change the poll's colours and position, and save.
- [ ] Alerts panel → add `!tim` → "Thả tim cho idol!" with a heart, and save. Then "Gửi thử thông báo".

**C2 OBS**

- [ ] Open OBS (not as Administrator). In the dashboard's "Cài đặt OBS" card, drag "Kéo nút này thả vào cửa sổ OBS" onto the OBS preview. OBS should add one browser source named "Engagement Tool", 1920×1080, and the card's step 2 should turn green within about 5 s. If dragging doesn't work, use "Sao chép link" and follow the steps under "Không kéo thả được?", then report it.
- [ ] With the demo still running, the poll (top left) and leaderboard (top right) update in OBS. The test alert appears bottom right. Changing a widget's style or corner and saving updates OBS without a refresh.
- [ ] Leaderboard style → turn off names and save. The leaderboard shows "Khán giả" while alerts still show names.
- [ ] Stop the demo.

**C3 Real stream (camera off)**

- [ ] YouTube Studio → Go live → Stream, visibility **Unlisted** (not Private: private streams have no chat). Copy the stream key into OBS → Settings → Stream.
- [ ] OBS: a background (colour or image) plus the "Engagement Tool" source → Start Streaming. Wait until YouTube Studio shows "Live".
- [ ] Dashboard → "Bắt đầu phiên live (YouTube)". It should find your stream. If it says the channel isn't live, wait 30 s and retry, then report it.
- [ ] Open a poll. From your phone (or a friend's account), type `!vote 1`, `!bình chọn 2` and `!binh chon 2` in the stream's chat. Expect counts in OBS within about 5–10 s (YouTube's chat delay plus polling).
- [ ] Type `!join` and `!tham gia`. The leaderboard shows the points with your display name.
- [ ] Type `!tim`. The alert appears. Typing it again immediately does nothing (30 s cooldown).
- [ ] If a friend can, send a small **Super Chat**. It should show as an alert with the amount and message, and must not change the poll or points.
- [ ] Check the live panel's quota line. Write down how many units 10 minutes used. (The chat reader polls YouTube today; `streamList` would cut this a lot. That's the Q-T1 measurement.)
- [ ] Stop the session, then stop streaming.

**C4 Afterwards**

- [ ] In a terminal: `curl -sI https://engagement-tool.<your-subdomain>.workers.dev/overlay/?preview=poll`. Expect exactly one `content-security-policy` line containing `frame-ancestors 'self'`.
- [ ] Optional: invite a friend as moderator (Members panel → their Google email) and have them accept on their own device.

## Part D: tell Claude

- [ ] Which steps failed, with the step number and any message shown.
- [ ] The quota used per 10 minutes (C3).
- [ ] How long a chat command took to show in OBS.
- [ ] Whether Google asked you to sign in again after about 7 days (Testing-mode refresh tokens expire, R4).

Known gaps that are expected, not bugs: the sign-in link needs a reconnect every 7 days in Google's Testing mode; each workspace gets about 50 live minutes a day while the chat reader polls; Super Chats were only tested on synthetic data before this run.
