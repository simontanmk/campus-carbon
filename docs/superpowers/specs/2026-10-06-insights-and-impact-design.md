# Insights and Campus Impact: Design

Date: 2026-10-06. This extends the main spec (`2026-09-29-campus-carbon-app-design.md`). It is the first of three new-feature specs, built in this order: (1) insights and campus impact, (2) weekly recap card, (3) rewards.

## 1. Goal

Two new screens built from the activity the app already records:

- **Campus impact (`/impact`).**
  - A public page of totals for the presentation projector and poster QR codes.
  - It makes the demo's story visible: how much CO₂e the scheme saves and how many students take part.
- **Insights.**
  - A working dashboard for the pilot team (admin, every stall) and a small panel for each seller (own stall only).
  - It shows whether low-carbon choices are rising, and where.

Success means:
- During the presentation, `/impact` on the projector shows honest, clearly labelled numbers that update while the audience claims meals.
- An admin can answer "which stall improved this week?" in one screen.

## 2. Scope

**In:**
- the public impact page
- the admin insights page
- the seller's "Your stall this week" panel
- three read-only endpoints

**Out:**
- CSV of insights (the activities export covers analysis)
- date pickers or custom ranges
- per-student drill-downs
- stored aggregates or migrations

## 3. Definitions

All of these are computed on read from `activities`, like missions and the leaderboard.

- **Week:** the SGT week (Monday 00:00 SGT), from `sgWeekStart`. "This week" runs from the week start to now.
- **Verified meal:** `type = 'meal' AND verified = 1`.
  - Photo meals are self-reported and don't count here (main spec §3).
- **Low-carbon share:** verified low-carbon meals ÷ verified meals in the period.
  - If there are no verified meals, the share is `null`, and the UI shows "—".
- **Average campus meal (kg):** the mean `kg_co2e` of items with `kind = 'meal'`, `status = 'live'`, a non-null kg, at active stalls.
  - It uses today's menu for every week shown. This is stated on the page as an assumption.
- **Estimated kg saved:** the sum, over verified low-carbon meals with a known kg, of `max(0, average − meal kg)`. It is rounded to 0.1 kg.
  - The label always says "estimated, vs an average campus meal".
- **Under budget (last week):**
  - **Who counts:** students whose budget was ready before last week started (`created_at + 7 days ≤` last week's start, so last week lies wholly after their baseline week) and who logged at least one activity with a kg last week.
  - **Under** means last week's kg ≤ the overall target.
  - **Total below target:** the sum of `target − last_week` over those students.
  - **Why last week:** this uses the last full week, because a part-week is trivially under target.
- **Active students:** distinct students with any activity this week.
- **Walking trips:** `type = 'trip'` with `detail.mode = 'walk'`.
- **Own cups and containers:** `type = 'byo'`.

## 4. Endpoints

All three are read-only. They use one pure module, `src/worker/lib/insights.ts`, which takes rows and timestamps and returns plain objects with no database access, plus thin routes in `src/worker/routes/insights.ts`.

### 4.1 `GET /api/impact` (public)

No session is needed. It sends `Cache-Control: public, max-age=30`. It returns only aggregates: no ids, no names, no stall breakdown.

```json
{
  "week_start": 1791..., "generated_at": 1791...,
  "avg_meal_kg": 1.12,
  "kg_saved": 41.3,
  "low_carbon_share": 0.62,
  "verified_meals": 58,
  "active_students": 23,
  "walk_trips": 31,
  "byo": 12,
  "under_budget": { "students": 9, "of": 14, "kg_below": 18.4 },
  "weeks": [{ "week_start": 1791..., "low_carbon_share": 0.4, "kg_saved": 12.1 }]
}
```

- `weeks` holds the 8 weeks ending with the current one, oldest first. Weeks with no data show a share of `null` and kg saved of 0.
- `under_budget` is `null` when no student qualifies.

### 4.2 `GET /api/admin/insights` (admin)

```json
{
  "stalls": [{ "id": "noodles", "name": "...", "this_week": Stats, "last_week": Stats }],
  "top_dishes": [{ "name": "...", "count": 7, "low_carbon": true }],
  "weeks": [{ "week_start": 1791..., "verified_meals": 20, "low_carbon_share": 0.5, "photo_meals": 4, "trips": { "walk": 9, "shuttle": 3, "car": 1 } }]
}
```

- `Stats` is `{ meals, low_carbon_share, avg_kg, byo }`, using verified meals at that stall. `avg_kg` is `null` when there are no meals with a kg.
- **Stalls:** every stall, active or not, ordered by name.
- **Top dishes:** up to 5 verified meals this week, by count, then by name.
- **Weeks:** the same 8-week window as §4.1.

### 4.3 `GET /api/stall/insights` (seller)

Returns `{ this_week: Stats, last_week: Stats }` for the seller's own `stall_id` only. A seller with no stall gets 404.

## 5. Screens

### 5.1 `/impact`

- It renders without a session. `App.tsx` must show it before the Welcome gate, so a visitor isn't asked for a name.
- **Layout:**
  - **Headline:** a serif number, "≈ 41.3 kg CO₂e saved this week", with the small label "estimated, vs an average campus meal (1.12 kg)".
  - **Second figure:** "9 of 14 students stayed under their budget last week · 18.4 kg below target". It is hidden when `under_budget` is null.
  - **Figure row:**
    - low-carbon share of verified meals
    - active students
    - walking trips
    - own cups and containers
  - **8-week chart:** an inline SVG of the weekly low-carbon share as bars, with kg saved underneath. No chart library.
  - **Footer:** "Campus Carbon · NTU CC0006 pilot", the update time, and a QR code to the app for the projector.
- Refreshes every 30 s.
- It follows the existing visual language: off-white, serif numbers, one green accent.
- It works at 375 px and at projector width (1280 px or more); on wide screens the figure row has four columns.

### 5.2 Admin insights (`/admin/insights`)

- A new "Insights" button on the admin hub.
- The page has three blocks:
  - **Stalls:** one row per stall: this week's meals, low-carbon share and own containers, with last week's value in muted text.
  - **Top dishes this week.**
  - **8-week table:** week, verified meals, low-carbon share, photo meals, and trips (walk / shuttle / car).
- An admin who has switched to a persona sees the existing "Admins only" page.

### 5.3 Seller panel

- At the top of the stall screen, above the item grid, a compact panel headed "Your stall this week":
  - meals claimed
  - low-carbon share
  - own containers
  - each with "last week: …" underneath
- It loads once when the screen opens and again after each claim.

## 6. Privacy and safety

- `/impact` never exposes names, ids, stalls or anything per student. It is safe for posters.
- The seller endpoint is filtered by the session's `stall_id` on the server, never by a parameter.
- No new writes, so no new abuse surface. A Worker's `Cache-Control` header alone isn't stored at Cloudflare's edge, so `/api/impact` caches its response in the Cache API (`caches.default`) for 30 s: D1 runs at most once per 30 s per data centre. The projector page polls with `cache: "no-store"` so it never reads a stale browser copy.

## 7. Testing

**Unit tests (`test/insights.test.ts`):**
- low-carbon share, including no meals → null
- kg saved:
  - only verified low-carbon meals count
  - photo meals are excluded
  - a meal heavier than average adds 0
- average meal: only live meals with a kg at active stalls
- under budget: uses last week, needs activity last week, and needs a ready budget
- the 8-week window: oldest first, empty weeks filled in

**Route tests:**
- `/api/impact` works with no cookie and has the cache header
- the response JSON contains no user id, display name or stall id
- `/api/admin/insights`:
  - returns 403 for a student, a seller, and a switched persona
  - stall rows match the seeded activity
- `/api/stall/insights`:
  - each seller sees only their own stall
  - a student gets 403

**Browser check:** `/impact` at 375 px and 1280 px while logged out; the admin insights page; the seller panel updating after a QR claim.

## 8. Build notes

- Reuse the existing helpers rather than adding new ones: `sgWeekStart`, `computeBudget`, the session middleware and `requireRole`.
- Load the 8-week window with one bounded query: `created_at >= weekStart − 7 weeks`, students only.
  - Budgets need each student's `created_at` and their first-week activity. Load those students' activity from their `created_at`, as `/me/summary` does, but only for students active last week.
