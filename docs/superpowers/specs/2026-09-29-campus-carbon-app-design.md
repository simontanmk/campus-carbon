# Campus Carbon Micro-App — Prototype Design

Date: 2026-09-29
Status: draft for review
Course: NTU CC0006 proposal

## 1. Goal

A working mobile web prototype, demonstrated live at the CC0006 presentation (about 5 weeks away, built part-time). Students track and reduce their footprint across food, mobility and waste, and earn points. Team members play students, sellers and admin on real phones.

This is a **demo, not a pilot**. The architecture should not block a later pilot, but pilot-only work (real identity, hardened abuse controls, device testing of NFC) is kept minimal and listed in §13.

Build the simplest version of each feature that visibly works. No overkill.

## 2. Scope

**In:** food purchases at canteen stalls, BYO cup/container, seller-triggered QR verification, NFC verification (minimal, experimental), mobility (trip suggestions, step mission), beverage container returns, daily and weekly missions, points, streaks, badges, leaderboard, weekly carbon budget, meal-swap suggestion, nudges, progress dashboard, admin CSV export, four AI features (§9).

**Out:** energy, native app, Web NFC API, reading Apple Health / Google Fit, reverse vending machine integration, email verification (schema-ready only).

## 3. Verified vs self-reported

Every activity carries `verified` (bool) and `source` (`qr`, `nfc`, `manual`, `photo`).

- Verified: stall meals, drinks and BYO, via a seller-issued token.
- Self-reported: trips, steps, container returns, photo-logged meals.

The dashboard shows both, labelled separately. The CSV export includes the flag. Evaluation of low-carbon meal share uses verified rows only. Self-reported actions earn fewer points and are capped per day (§7).

## 4. Architecture

One Cloudflare Worker serves both the static React app and the API, backed by one D1 database. (The original spec said Pages + Pages Functions; Cloudflare now recommends Workers with static assets for new projects. Same behaviour, one deploy.) The demo runs on the Worker's public `https://…workers.dev` URL so phones can open QR links.

```
src/worker/        Hono API routes, one file per area:
                   auth, stall, claim, activities, trips, missions, ai, admin
src/worker/lib/    pure modules, no DB access, unit-tested:
                   carbon   ingredient grams × factors → kg; low-carbon rule
                   scoring  points, daily cap, streaks, missions, badges
                   budget   baseline, weekly totals, deltas, biggest source, best swap
                   token    HMAC sign / verify
                   ai       OpenAI-compatible client + mock backend
src/app/           React SPA (Vite), mobile-first, plain CSS
migrations/        D1 SQL migrations
seed/              factors, meals, drinks, stalls, locations, routes, personas, baseline week
```

Hono is a small routing library for Workers: it maps URLs such as `POST /api/claim` to handler functions. Route handlers stay thin: they read and write D1 and call the pure modules, which hold every rule.

## 5. Identity and roles

- A signed cookie holds the user id. On first visit the student enters a display name (no email).
- `users.role` is `student`, `seller` (bound to one `stall_id`) or `admin`.
- Sellers and admins cannot claim tokens.
- Admins get a **persona switcher** so one device can act as any seeded user during the demo.
  - The switch capability (`adm` cookie) lasts 12 hours. "Stop switching on this device" drops it and keeps the current persona, for handing a phone to someone else.
- `email` and `email_verified_at` exist in the schema but are unused. A later pilot adds "verify your NTU email" without a data migration.

Known limitation: clearing cookies creates a fresh account, which bypasses per-student rate limits. Accepted for the demo.

## 6. Data model (D1)

Changes from the original spec: `purchases` is merged into `activities` (one table feeds the dashboard, budget, leaderboard and export), and emission factors are stored in a `factors` table with their sources.

```
users         id, display_name, role, stall_id?, email?, email_verified_at?, created_at
stalls        id, name, canteen, active, verify_method (qr|nfc|both, default qr)
items         id, stall_id, name, kind (meal|drink), parts_json, kg_co2e?, low_carbon,
              points, status (draft|live)
tokens        id, stall_id, item_id, byo, method (qr|nfc), created_at, expires_at,
              pending_user_id?, confirmed_at?, used_at?, used_by?
activities    id, user_id, category (food|mobility|waste),
              type (meal|drink|byo|trip|steps|container_return),
              kg_co2e?, points, verified, source (qr|nfc|manual|photo),
              token_id?, stall_id?, item_id?, low_carbon?, image_hash? (unique),
              detail_json, created_at
factors       key, kg_per_unit?, unit (kg|pkm), source, note     -- null value = pending
locations     id, name
routes        from_id, to_id, distance_km, walk_min, shuttle_min
missions      id, name, category, target, points, period (daily|weekly)
user_missions user_id, mission_id, period_start, progress, completed_at?
badges        id, name, rule
user_badges   user_id, badge_id, earned_at
summaries     user_id, week_start, text, created_at
settings      key, value     -- point values, caps, rate limits
```

Computed on read, not stored: missions (progress and completion), streaks, badges, weekly budget, leaderboard, nudges. They are all pure functions of `activities`, so a mission can't pay twice and nothing drifts out of sync. `missions` and `badges` hold the definitions (seeded from code). `user_missions` and `user_badges` stay in the schema but aren't used in the demo. Carbon Champion reflects last week's leaderboard.

A null `kg_co2e` (e.g. Teh-O kosong, pending mobility factors) means "not estimable". The UI shows "—" or "factor pending", and budget totals skip it.

## 7. Scoring

All values live in `settings` and can be edited in admin.
- Minimums: code lifetime ≥ 15 s, daily claim limit ≥ 1, AI calls per day ≥ 1. Lower values would make codes expire at once or block every claim.
- Mission rewards live in `mission_points` (mission, effective week, points). A new reward applies from the SGT week it is saved, so past weeks' totals and last week's Carbon Champion don't change. The seeded `missions.points` column is only the default.

| Action | Verified | Points |
|---|---|---|
| Stall meal, low-carbon | yes | +20 |
| Stall meal, not low-carbon | yes | 0 (logged) |
| Stall drink | yes | 0 (logged) |
| BYO cup/container (token `byo` flag) | yes | +15 |
| Photo meal, AI-identified as low-carbon | no | +5 |
| Photo meal, not low-carbon | no | 0 (logged) |
| Walk trip | no | +10 |
| Shuttle trip | no | +5 |
| Car / Grab trip | no | 0 (logged) |
| Container return | no | +5 each |
| Step entry | no | 0 (counts toward step mission) |

- **Daily cap on self-reported points:** 30. Mission rewards do not count toward it.
- **Low-carbon rule (meals):** the meal's protein is plant-based or egg only. Implemented on ingredients: a meal is low-carbon if its `parts` contain none of `poultry`, `pork`, `beef_herd`, `beef_dairy`, `fish_farmed`. Drinks are not classified.
- **Missions.** Weekly: 2 low-carbon meals (+100), 5,000 steps (+100), BYO once (+80), all weekly missions done (+50 bonus). Daily: walk one campus trip (+20), log one low-carbon meal (+20).
- **Photo meals (decided 2026-09-30):**
  - The food missions and the Low-Carbon Foodie badge count only stall-verified meals. Self-reported photo meals therefore can't unlock +20/+100 bonuses, and self-reported actions stay a minor share of points.
  - A photo meal earns +5 only when Gemini (not the offline mock) identified it.
  - Confirming requires a signed ticket from the analyse step, bound to the student and the photo's hash.
- **Streak:** consecutive days with at least one logged activity.
- **Badges:**
  - Green Starter: first activity
  - Low-Carbon Foodie: 10 low-carbon meals
  - Campus Walker: 20 km walked in one week
  - Zero-Waste Hero: 10 BYO
  - Carbon Champion: top of last week's leaderboard
- **Leaderboard:** points this week, all students.

Known limitation: non-low-carbon stall meals earn no points, so students have little reason to scan them. The verified low-carbon share will be biased upward. Accepted by the team. Stated in the proposal as a pilot risk.

## 8. Flows

### 8.1 QR claim
1. The seller opens the stall view, taps an item and optionally toggles BYO. `POST /api/stall/tokens` creates a token (`method=qr`, 90 s expiry).
2. The token string is `<id>.<hmac>`, where the HMAC is keyed by the Worker secret `TOKEN_SECRET`. The stall view shows a QR code for `https://<app>/claim?t=<token>` with a countdown.
3. The student scans with the phone camera. With no cookie, they enter a display name first, then the claim resumes.
4. The server checks, in order: signature valid, not expired, not used, stall active, user is a student, rate limits (1 per stall per 10 min, 5 per day).
5. The server marks the token used with `UPDATE tokens SET used_at=?, used_by=? WHERE id=? AND used_at IS NULL`. It proceeds only if exactly one row changed, so the first of two simultaneous scans wins.
6. The server inserts the meal or drink activity, plus a `byo` activity if flagged. It then re-evaluates missions and badges. The student sees points, kg and the low-carbon label.
7. The stall view polls the token every 2 s and shows "Claimed by <name>".

### 8.2 NFC (experimental, minimal)
A static NFC sticker holds `https://<app>/tap?stall=<id>`. It uses the phone's built-in tag reader, not Web NFC.
1. The seller taps an item. This creates a `method=nfc` token and expires any other pending token at that stall.
2. `/tap?stall=<id>`: if a pending, unexpired token exists with no `pending_user_id`, it is set to the student.
3. The stall view shows the student's name and a Confirm button. Confirm sets `confirmed_at` and records the activity as in QR steps 5–6. Nothing is recorded without Confirm.
4. Confirm latency (`confirmed_at − created_at`) is kept for measuring seller workload.

Implemented: the seller's sheet shows the tapping student's name with Confirm. The student's page waits and shows the points after Confirm. Rate limits are checked at tap and again at Confirm. A new NFC token at a stall expires the previous pending one.
- **Wrong tapper:** "Not them?" on the seller's sheet clears the tap, so the customer in front of the seller can tap; the cleared student is told to tap again.
- A student holds one pending tap at a time. Tapping another stall releases the first, so one person can't hold several stalls' tokens.
- Confirm is refused if the stall has since been set to QR only.
- The per-stall window and the daily limit are checked again inside the single `UPDATE` that marks a token used (QR and NFC), so two codes claimed at the same moment can't both pass.
- The seller's countdown runs from the server's remaining time (`expires_at − server_now`), not the device clock. Tapping outside the sheet closes it only once the code is claimed or expired.

Device testing (iPhone background reading, sticker placement near metal) is left to the team.

### 8.3 Trip
Choose origin and destination (dropdowns, or typed text via AI §9.2). The app looks up `routes` in either direction and shows three options:
- walk: 0 kg
- shuttle: `distance_km × factor(shuttle)`
- car/Grab: `distance_km × factor(car)`

Assumption: shuttle and car kg use the walking distance between the two places (the only distance stored). The OSRM driving route is usually a little longer, so shuttle and car kg are slightly understated. State this in the proposal.

Each option shows its time and points. A pending factor shows "factor pending". Tapping an option logs a self-reported trip.

### 8.4 Steps and container returns
Manual number entry, self-reported. The step count adds to the weekly step mission.

### 8.5 Errors
Every failure shows a plain-language message, never a stack trace:
- expired token: "Ask the stall for a new code"
- token already used
- rate-limited
- seller or admin trying to claim
- unknown or inactive stall
- no pending NFC token

## 9. AI features

### 9.1 Client
`ai.json({ instructions, text, image? })` returns parsed JSON, validated against a schema for each feature.

Configuration:
- `AI_MODE` = `live` or `mock`
- `AI_BASE_URL`, `AI_MODEL`
- `AI_API_KEY` (Worker secret)

Configured provider (2026-09-30): Google Gemini via `https://generativelanguage.googleapis.com/v1beta/openai/`. Primary `gemini-flash-lite-latest` (fast, and it answered when the larger Flash models were returning 503 "high demand" on the free tier). Fallback `gemini-3.8-flash`. The 8 s timeout applies per attempt, so the worst case is two attempts, then the mock. Known bias: photo estimates may use cooked rather than dry rice weights, which overstates kg. The Worker is pinned near Singapore (`placement.region = "gcp:asia-southeast1"`): without it, some requests ran in Cloudflare data centres where Gemini's free API returns 400 "User location is not supported", and those fell back to the mock.

Any OpenAI-compatible chat-completions provider works. Google Gemini (AI Studio free tier) is the first choice. OpenRouter free models (e.g. Qwen), Groq, Alibaba Model Studio and OpenAI also work. Free tiers may use data for training, which is acceptable only with demo data.

On error, timeout (8 s) or a schema mismatch, the client returns the mock response and the UI shows a small "offline estimate" label.

**AI never produces kg or the low-carbon flag.** It returns dish names and ingredient grams restricted to `factors` keys. The `carbon` module computes kg, and the rule in §7 decides low-carbon.

### 9.2 Features
1. **Menu photo → draft items (admin).**
   - The photo is resized on the phone to about 1024 px. The AI returns `[{name, kind, parts}]`.
   - The server computes kg and low-carbon and saves the items as `draft`. The admin edits and approves them to `live`.
2. **Typed trip (student).** "Hive to Hall 11" → `{from_id, to_id}`, chosen only from the `locations` list. If there is no match, the dropdowns are shown. Then the normal trip flow (§8.3).
3. **Meal photo (student, stalls not onboarded).**
   - The camera opens directly (`capture` attribute). The AI returns `{dish, parts, confidence}`.
   - The student confirms or edits, then it is logged `verified=false, source=photo`. It earns +5 if low-carbon and counts toward the daily cap.
   - A SHA-256 of the image file goes into `image_hash`. Duplicates are rejected.
4. **Weekly summary and nudge.** The `budget` module computes the facts. The AI writes 2–3 sentences using only those facts. Mock mode uses a template. Cached in `summaries` per user per week.

**Per-student AI limit.** Each student gets `ai_daily_max` (default 20, editable in admin) live AI calls per SGT day across typed trips, meal photos and nudges, recorded in `ai_calls`. Over the limit, typed trips and meal photos return a plain message (pick from the lists, or scan the stall's code), and the nudge uses the offline sentence. Nothing is counted when no live model is configured.

**Menu import with the AI offline** returns "try again" and writes nothing. The offline stand-in dishes are no longer saved as drafts.

Privacy: images are never stored. The provider receives only images being analysed, typed trip text, and computed numbers with a display name.

## 10. Weekly budget, dashboard and nudges

- **Baseline:** the total for the student's first 7 days (from `created_at`), overall and per category (food, mobility, waste).
- **Target:** baseline × 0.85. Not a fixed number.
- **Home shows:**
  - remaining budget, overall and per category
  - change vs last week per category
  - biggest source this week
  - the single highest-impact swap from the student's own history: the most frequent higher-carbon meal × (its kg − the lowest-kg low-carbon meal at the same stall, falling back to any stall)
  - one nudge (§9.2.4)
  - streak and points
  - verified and self-reported labelled separately
- **Demo build (decided 2026-09-29):** to keep Home uncluttered, it shows remaining budget, per-category usage and a "self-reported" tag on unverified rows. "Change vs last week" and "biggest source" are computed by the API (`budget.categories[*].last_week`, `budget.biggest`) but not shown.
- **Weeks:** Monday 00:00 to Sunday 23:59, Asia/Singapore.
- **Demo seeding:** personas are created with back-dated `created_at` and a seeded baseline week, so the budget and deltas show realistic numbers immediately.

Known limitation: a student stays under budget by not logging. Accepted for the demo.

## 11. Screens

**Student**
- Home (§10)
- Log: trip planner with typed input, steps, container return, meal photo
- Claim result (`/claim`, `/tap`)
- Missions & badges
- Leaderboard

**Seller**
- Stall view: item grid, BYO toggle, QR with countdown and claim status
- NFC waiting / Confirm state (NFC stalls only)

**Admin**
- Stalls & items (CRUD, `verify_method`)
- Menu photo import with draft review
- Persona switcher
- Point and cap settings
- CSV export of activities (every column, including `verified` and `source`)

Implemented: Stalls and items (active, verify method, NFC sticker link, edit and add items with ingredients in grams, approve and hide), Points and limits (all settings, including mission rewards), CSV export, menu photo import. Admin tools need the real admin role. A switched persona sees only the persona list.
- **Campus impact** (`/impact`, public) and **Insights** (`/admin/insights`; seller panel on the stall screen): see `2026-10-06-insights-and-impact-design.md`.
- **Weekly recap card** (`/recap`, students): see `2026-10-07-weekly-recap-card-design.md`.

## 12. Visual design

Apple-like, minimal, off-white:
- off-white background (around `#F7F7F5`), white cards, one accent colour (green)
- system font stack (`-apple-system`, SF Pro, then system-ui)
- generous spacing, large clear numbers for kg and points
- dark mode optional, not required

Liquid glass (using the team's glass-UI skill) is used **only on floating chrome**: the bottom tab bar, the seller QR card, and sheets and modals. Everything else stays flat. Glass over a flat off-white page reads as grey boxes, so restraint keeps it clean.

## 13. Deferred to a pilot

- NTU email verification (magic link)
- stronger abuse controls
- real-device NFC testing
- reverse vending machine data
- paid AI tier for student data
- control-canteen analysis tooling

## 14. Seed data

### 14.1 Emission factors (kg CO2e per kg product)
Global means from Poore & Nemecek (2018), via Our World in Data.

| key | value |
|---|---|
| rice | 4.45 |
| wheat | 1.57 |
| poultry | 9.87 |
| pork | 12.31 |
| beef_herd | 99.48 |
| beef_dairy | 33.30 |
| fish_farmed | 13.63 |
| eggs | 4.67 |
| tofu | 3.16 |
| milk | 3.15 |
| coffee | 28.53 |
| cane_sugar | 3.20 |
| veg | 0.43 (root vegetables, used as a proxy for all vegetables) |

TODO before submission: confirm `beef_dairy`, `fish_farmed` and `coffee` directly on ourworldindata.org/grapher/ghg-per-kg-poore. They were checked via a secondary source.

Mobility factors (kg CO2e per passenger-km), from UK DESNZ (2022) conversion factors via Our World in Data, "Carbon footprint of travel per kilometer" (ourworldindata.org/grapher/carbon-footprint-travel-mode):
- `car` = 0.1705 ("Petrol car", single occupant). Also used for Grab, because the dataset has no taxi row.
- `shuttle` = 0.0965 ("Bus (average)"). This is a cautious proxy. NTU launched electric campus shuttles with ComfortDelGro and says the fleet "will eventually be fully electrified" (ntu.edu.sg), so the fleet is not fully electric yet. The real per-passenger figure is lower and falling. Revisit it once NTU publishes fleet or energy data.

### 14.2 Meals
Portions are team assumptions. Rice and noodles are dry weight. Excluded: cooking oil, cooking energy, packaging, food waste, so all values are underestimates. The kg values are recomputed from parts by the `carbon` module; the listed values have been checked against it.

```json
[
  {"id":"econ-veg-egg","name":"Economy rice: 2 veg + egg","parts":{"rice":80,"veg":150,"eggs":50},"kg":0.65,"low_carbon":true},
  {"id":"econ-veg-tofu","name":"Economy rice: 2 veg + tofu","parts":{"rice":80,"veg":150,"tofu":80},"kg":0.67,"low_carbon":true},
  {"id":"veg-noodles","name":"Vegetarian noodles with tofu","parts":{"wheat":100,"veg":100,"tofu":60},"kg":0.39,"low_carbon":true},
  {"id":"wanton-mee","name":"Wanton / char siew noodles","parts":{"wheat":100,"pork":60,"veg":30},"kg":0.91,"low_carbon":false},
  {"id":"econ-chicken","name":"Economy rice: 1 chicken + 1 veg","parts":{"rice":80,"poultry":80,"veg":75},"kg":1.18,"low_carbon":false},
  {"id":"chicken-rice","name":"Chicken rice","parts":{"rice":80,"poultry":100,"veg":30},"kg":1.36,"low_carbon":false},
  {"id":"econ-pork","name":"Economy rice: 1 pork + 1 veg","parts":{"rice":80,"pork":80,"veg":75},"kg":1.37,"low_carbon":false},
  {"id":"econ-fish","name":"Economy rice: 1 fish + 1 veg","parts":{"rice":80,"fish_farmed":80,"veg":75},"kg":1.48,"low_carbon":false},
  {"id":"fish-soup","name":"Fish soup with rice","parts":{"rice":80,"fish_farmed":120,"veg":80},"kg":2.03,"low_carbon":false},
  {"id":"beef-hor-fun","name":"Beef hor fun","parts":{"rice":80,"beef_dairy":80,"veg":30},"kg_range":[3.03,8.33],"kg":5.7,"kg_override":true,"low_carbon":false,"note":"rice noodles; range is 80 g beef_dairy (3.03) to 80 g beef_herd (8.33); kg is the midpoint"}
]
```

Changes from the original data:
- `beef-noodles` is renamed `beef-hor-fun`, because the parts use rice (hor fun is a rice noodle).
- The "source unknown" note is corrected: the range comes directly from the dairy-herd and beef-herd factors.
- Parts use `beef_dairy`, so the low-carbon rule works on it. `kg_override` means the stored kg is the 5.7 midpoint rather than the value computed from parts.

### 14.3 Drinks (per cup: 10 g coffee, 50 g milk, 10 g sugar)
Drinks are logged when claimed at a stall but earn 0 points. BYO cup earns points (§7).

```json
[
  {"id":"kopi","name":"Kopi (with milk, sugar)","parts":{"coffee":10,"milk":50,"cane_sugar":10},"kg":0.47},
  {"id":"kopi-o-kosong","name":"Kopi-O kosong","parts":{"coffee":10},"kg":0.29},
  {"id":"teh","name":"Teh (with milk, sugar)","parts":{"milk":50,"cane_sugar":10},"kg":0.19,"note":"tea leaves not in dataset, excluded"},
  {"id":"teh-o-kosong","name":"Teh-O kosong","parts":{},"kg":null,"note":"not estimable from dataset"}
]
```

Assumption to state in the proposal: local kopi uses condensed or evaporated milk. Fresh milk is used here as a proxy.

### 14.4 Stalls, locations, personas
- **Stalls:** three generic demo stalls in one demo canteen:
  - economy rice (`verify_method=qr`)
  - noodles (`both`)
  - drinks (`qr`)
- **Locations:** The Hive, North Spine, South Spine, Hall 11, Sports and Recreation Centre, Canteen 2.
- **Routes:** walking distance and time, and driving time, for every pair of the 6 demo locations (15 routes). Generated by `npm run seed:routes` from OpenStreetMap via OSRM (routing.openstreetmap.de), using location coordinates from OpenStreetMap Nominatim. Shuttle time = driving time + 5 min average wait (an assumption). Lee Wee Nam Library was dropped: its OpenStreetMap footpaths aren't connected to the rest of campus, and routing gave 1.4 km for a 140 m walk.
- **Personas:**
  - 3 students with different habits (e.g. meat-heavy, already low-carbon, mixed) and back-dated baseline weeks
  - 1 seller per stall
  - 1 admin

## 15. Findings to state in the proposal
- Fish soup (2.03 kg), often seen as the healthy option, is the highest non-beef dish. Healthier and lower-carbon are different criteria.
- The most common realistic swap, chicken rice to vegetable economy rice, saves about 0.7 kg per meal.
- One beef meal equals roughly 5 to 13 plates of vegetable economy rice.

## 16. Testing
- **Vitest unit tests** for the pure modules:
  - `carbon`: every seed meal reproduces its listed kg (beef hor fun reproduces its range ends instead); the low-carbon rule
  - `scoring`: the points table, daily cap, streaks, missions, badges
  - `budget`: baseline, deltas, best swap
  - `token`: sign / verify / tamper
- **One integration test** of the QR claim against local D1: create, claim, double-claim rejected, expired rejected, seller rejected.
- **AI** tested in mock mode only. Live providers are checked by hand.
- **Manual pre-demo checklist** on one iPhone and one Android: scan a QR, claim, check the stall status updates, persona switch, photo capture, NFC tap (if a sticker is available).

## 17. Build stages
There should always be something working to demo.
1. Scaffold, deploy, accounts and roles, seed data, stall view, QR claim, food points, basic home
2. Trips, steps, container returns, missions, streaks, badges, leaderboard, weekly budget and dashboard
3. AI client with mock backend, then features 1–4 against a free provider
4. NFC flow, CSV export, admin settings, visual polish, pre-demo checklist

## 18. Sources
- Poore, J. and Nemecek, T. (2018). Reducing food's environmental impacts through producers and consumers. *Science* 360(6392), 987–992.
- Our World in Data, GHG emissions per kg of food product: https://ourworldindata.org/grapher/ghg-per-kg-poore
- Web NFC browser support: https://caniuse.com/webnfc
- Apple, background tag reading: https://developer.apple.com/documentation/corenfc/adding-support-for-background-tag-reading
