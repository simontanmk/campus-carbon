# Demo checklist (real phones)

Live site: https://campus-carbon.stan322.workers.dev

Devices:
- **Seller:** a phone with a working camera, switched to a seller persona.
- **Students:** one iPhone and one Android.
- **Projector:** the presentation laptop.

Open the app in Safari or Chrome. Don't open it inside a chat app's built-in browser: those can drop the login cookie, so a returning student looks like a new user.

## Before the demo

- [ ] **Admin sign-in (once):** set a passcode of 12 or more characters as a Cloudflare secret. You'll be asked to type it; it's never stored in the repo:
      `npx wrangler secret put ADMIN_PASSCODE`
- [ ] **Make a phone admin:** on that phone, open `/admin/login`, enter the passcode → Admin. To make it a seller phone, go to Switch persona → the stall's seller. If switching expires (12 h) or someone taps "Stop switching", sign in at `/admin/login` again.
- [ ] **Morning of the demo, refresh the personas (Alex, Bea, Chen):** move their seeded history so it ends yesterday. Nothing is deleted, and real claims are untouched:
      `npm run seed:rebase`

- [ ] **Limits:** rehearsal claims count toward them (5 per day, 1 per stall per 10 min). For the live run, use a fresh display name, or raise the daily limit for the day in Admin → Points and limits (`rate_daily_max`), or with:
      `npx wrangler d1 execute campus-carbon --remote --command "UPDATE settings SET value='50' WHERE key='rate_daily_max'"`
- [ ] **AI allowance:** each student gets 20 live AI calls a day (Points and limits → `ai_daily_max`). Raise it for heavy rehearsals.
- [ ] **Reward stock:** check it in Admin → Rewards (Free kopi 20 a week, $1 off 30 a week). Top it up if rehearsals used some.
- [ ] **Switched phones:** before handing one to someone, open Switch → "Stop switching on this device". The ability to switch also expires on its own after 12 hours.
- [ ] **Mission rewards:** if you change them during the demo, the change applies from the start of this week. Students who already spent points may then see "Your points were adjusted…" on Rewards. That's expected.

## Claims: QR (seller-verified)

- [ ] The seller taps a low-carbon item with "Own cup or container" on: a QR code and countdown appear.
- [ ] The iPhone camera scans the QR → Safari opens → Welcome (first time only) → +35 shows without a second scan.
- [ ] The seller's screen shows "Claimed by <name>" within about 2 s.
- [ ] Android camera or Google Lens scans a new QR: the claim works.
- [ ] Rescanning a used QR says "already used".
- [ ] After 90 s the seller sees "This code expired"; "New code" works.
- [ ] Same student, same stall, second claim within 10 minutes: rate-limit message.
- [ ] Chicken rice claim: 0 points, 1.36 kg shown.
- [ ] The seller's "Your stall this week" panel (meals, low-carbon %, own containers, with last week's figures) goes up after a claim.

## Claims: NFC sticker

Write the stall link from Admin → Stalls and items onto a sticker. Set the stall to NFC or Both.

- [ ] The seller chooses "NFC sticker" and taps an item: a "Tap" pulse and countdown appear.
- [ ] iPhone (XS or later, unlocked, camera closed) taps the sticker → Safari opens `/tap` → "waiting for the seller".
- [ ] The seller sees the name, with the countdown still running → Confirm → the student's screen shows the points.
- [ ] Android with NFC on: same flow.
- [ ] Tapping the sticker twice, or reloading, keeps the same pending claim.
- [ ] Wrong name on the seller's sheet → "Not them?" → the sheet goes back to waiting, and the other phone says "The seller cleared this tap".
- [ ] Switching the stall to QR only while a tap is pending makes Confirm say the stall now uses QR codes.

## Logging (self-reported)

- [ ] **Log → trip:** pick The Hive → North Spine: walk, shuttle and car options with minutes and points, and "Routes © OpenStreetMap contributors" underneath. Tap Walk → +10.
- [ ] **Typed trip:** "hive to hall 11" → both places filled.
- [ ] **Steps and container returns:** each logs with a toast. The 30-point daily cap for self-reported logs shows "daily limit reached".
- [ ] **Today → Snap a meal:** photo of a real dish → "AI estimate" card → fix the name if needed → Log meal → it appears in Recent, and the toast stays even on a new student's first log.
- [ ] **Gemini down?** The app shows "Offline estimate" and photo meals earn 0. Nothing else breaks.
- [ ] **After 20 AI calls in a day,** a typed trip or photo says today's AI help is used up, and the dropdowns still work.

## Progress

- [ ] **Today:**
  - points this week
  - budget line: Food/Mobility "x of y kg", or "Your budget starts …" in the first week
  - week dots
  - nudge and swap lines
  - Recent
  - "See campus impact ›" at the bottom
- [ ] **Missions:** today's and this week's missions, streak and badges.
- [ ] **Ranks:** you're highlighted.
- [ ] **Tab bar:** 5 tabs (Today, Log, Missions, Ranks, Rewards) fit on the smallest phone you have.

## Weekly recap card

- [ ] Today → "Your week in review" → the card draws. Under the title: last week's dates, or "This week so far" for a student who only has activity this week (it opens on that week).
- [ ] The "Last week" / "This week so far" switch redraws the card. An empty week says "Nothing logged that week" or "Nothing logged yet this week".
- [ ] Share → Instagram Story (iPhone and Android) shows the 1080×1920 card. WhatsApp sends it as an image. On a laptop the button is Download.

## Rewards

- [ ] **Student → Rewards tab:**
  - "points to spend", "Earned X · spent Y", and three rewards
  - rewards you can't redeem say why ("Need N more", "All gone this week")
- [ ] **Redeem "Free kopi":**
  - a code (e.g. `AZR-2HT`) with a QR code and a 10-minute countdown appears
  - the balance drops by 150
  - Cancel puts the points back
- [ ] **Seller confirms by typing:** Redeem a reward → type the code (any case, dash optional) → "Free kopi for <name>". On the student's phone, within about 2 s, the code card disappears and a "Redeemed ✓ Free kopi" message shows. The balance and history update, and Ranks is unchanged.
- [ ] **Seller confirms by scanning:** Redeem a reward → Scan code → allow the camera → point at the student's QR → "<reward> for <name>" without typing. Android phones also give a short vibration; iPhones don't support it.
- [ ] **Scanning fallbacks:**
  - deny the camera once: "Camera blocked…", and typing still works
  - scanning a claim QR by mistake is ignored
- [ ] **Wrong stall:** "This reward is for Drinks." The code still works at Drinks.
- [ ] **Retrying a confirm that already went through:** "Already confirmed here at <time>".
- [ ] **Typing O, I, L, 0 or 1:** "Codes never use O, I, L, 0 or 1."

## Projector: campus impact

- [ ] Open `/impact` on the presentation laptop. No login is needed, and there is no back link.
- [ ] It shows:
  - a big "≈ kg CO₂e saved", labelled as an estimate against today's menu average
  - "students under their budget last week"
  - four figures
  - 8 weekly bars with kg saved under each
  - a QR code in the corner
- [ ] Claim a meal on a phone: within about a minute the numbers move. The page and the server each keep results for up to 30 s.
- [ ] From a student's Today → "See campus impact ›": the page shows "‹ Back to Today".

## Admin

- [ ] **Admin → Insights:**
  - each stall, this week against last week
  - top dishes, with the stall name
  - an 8-week table
  - the link to the public impact page works
- [ ] **Admin → Rewards:**
  - edit cost, stock, stall and on/off → "Saved"
  - add a reward and check students see it
  - "Download redemptions (CSV)" works
- [ ] **Admin → Points and limits:** the minimums are enforced (code lifetime 15 s or more, daily limit 1 or more).
- [ ] **Admin → Stalls and items:** edit an item. The NFC sticker link is shown.
- [ ] **Admin → Export activities (CSV):** opens in a spreadsheet, with `verified`, `source` and `confirm_latency_ms` (NFC rows) columns.
- [ ] **A switched persona opening an `/admin/…` page** sees "Admins only", not a blank screen.

## Evaluation data

- [ ] **Activities CSV:**
  - verified vs self-reported meals
  - low-carbon share
  - NFC confirm latency, a measure of seller workload
- [ ] **Redemptions CSV:** which rewards were used, at which stall, and when.
