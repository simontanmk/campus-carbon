# Stage 1 demo checklist (real phones)

Seller device: laptop or tablet, switched to a seller persona.
Student devices: one iPhone, one Android.

- [ ] Seller taps a low-carbon item with BYO on → QR code and countdown show
- [ ] iPhone camera scans QR → opens Safari → Welcome (first time) → +35 shown without a second scan
- [ ] Seller screen shows "Claimed by <name>" within ~2 s
- [ ] Android camera / Google Lens scans a new QR → claim works
- [ ] Rescanning a used QR → "already used"
- [ ] Waiting 90 s → seller sees "Code expired" → New code works
- [ ] Same student, same stall, second claim within 10 min → rate-limit message
- [ ] Chicken rice claim → 0 points, 1.36 kg shown
- [ ] Student home shows points this week and recent activity

## Before the live demo
- [ ] Rehearsal claims count toward the limits (5 per day, 1 per stall per 10 min). For the live run, use a fresh display name, or raise the daily limit for the day:
      `npx wrangler d1 execute campus-carbon --remote --command "UPDATE settings SET value='50' WHERE key='rate_daily_max'"`
- [ ] Open the app in Safari or Chrome, not inside a chat app's built-in browser: in-app browsers can drop the login cookie, so a returning student looks like a new user.

## Stage 2–4 checks (real phones)

- [ ] Today → Snap a meal → photo of a real dish → "AI estimate" card → edit the name if needed → Log meal → appears in Recent
- [ ] Log → type "hive to hall 11" → Find → both places filled → tap Walk → +10
- [ ] Missions shows today's and this week's missions; Ranks shows you highlighted
- [ ] NFC (needs a sticker written with the stall link from Admin → Stalls and items):
  - [ ] Seller (stall set to NFC or Both) chooses NFC sticker, taps an item → "Tap" pulse
  - [ ] iPhone (XS or later, unlocked, camera closed) taps the sticker → Safari opens /tap → "waiting for the seller"
  - [ ] Seller sees the name → Confirm → student screen shows the points
  - [ ] Android with NFC on: same flow
  - [ ] Wrong name on the seller's sheet → "Not them?" → sheet goes back to waiting; the other phone says "tap the sticker again"
  - [ ] Confirm latency is in the export: `confirm_latency_ms` (seller item tap → Confirm), on rows with source `nfc`
- [ ] Projector: open /impact on the presentation laptop (no login needed) → big "kg saved" number, 8-week bars, QR in the corner; claim a meal on a phone → within 30 s the numbers move
- [ ] Recap card: Today → "Your week in review" → Share → Instagram Story (iPhone and Android) shows the 1080×1920 card; WhatsApp sends it as an image; on a laptop the button is Download
- [ ] Rewards: student Rewards tab → Redeem "Free kopi" → code shows with a 10-minute countdown → Drinks seller phone → "Redeem a reward" → type the code → "Free kopi for <name>"; the student's card flips to Redeemed and the balance drops; Ranks unchanged
- [ ] Rewards QR: seller phone → Redeem a reward → Scan code → allow camera → point at the student's QR → "<reward> for <name>" without typing; deny camera once and check typing still works
- [ ] Admin → Rewards: adjust costs/stock for the demo; "Download redemptions (CSV)"
- [ ] Admin → Insights shows each stall this week vs last week; a seller sees "Your stall this week" above the menu
- [ ] Admin → Export activities (CSV) opens in a spreadsheet; verified and source columns present
- [ ] Before handing a switched phone to someone, open Switch → "Stop switching on this device"
- [ ] Each student has 20 live AI calls a day (Points and limits → ai_daily_max); raise it for heavy rehearsals
- [ ] Gemini down? The app shows "Offline estimate" and photo meals earn 0. Re-check later; nothing else breaks.
