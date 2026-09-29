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
