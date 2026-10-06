# Weekly Recap Card: Design

Date: 2026-10-07. This extends the main spec (`2026-09-29-campus-carbon-app-design.md`) and reuses the calculations from `2026-10-06-insights-and-impact-design.md`. It is the second of three new-feature specs: (1) insights and impact, done; (2) this recap card; (3) rewards.

## 1. Goal

Students can share a story-sized image of their week, such as an Instagram Story or a WhatsApp message.

It does two things:
- rewards the student with something to show off
- carries a QR code that invites friends to join

Success means a student can go from Today to a shared Instagram Story in three taps, and the numbers on the card match what Today and Ranks showed for that week.

## 2. Scope

**In:**
- a "Your week in review" entry on Today
- a `/recap` screen with a week switch, a preview and Share/Download
- one read-only endpoint
- the image drawn on the phone

**Out:**
- public recap links or server-made images
- badges earned in a given week (badges aren't stored with dates)
- themes
- recaps of older weeks

## 3. Weeks

- **The switch:** Last week | This week so far. It opens on Last week.
- **Last week** is the previous SGT week, `[sgWeekStart(now) − 7 days, sgWeekStart(now))`. Its numbers are final.
- **This week so far** runs from `sgWeekStart(now)` to now. The card says "so far", and the rank says "currently".

## 4. Endpoint: `GET /api/me/recap?week=last|this`

- **Access:** students only (`requireRole("student")`); others get 403.
- **Default:** a missing or unknown `week` means `last`.
- **Computed on read:** nothing is stored.

```json
{
  "week": "last",
  "week_start": 1790524800000,
  "week_end": 1791129600000,
  "first_name": "Simon",
  "empty": false,
  "points": 185,
  "verified_meals": 6,
  "low_carbon_meals": 4,
  "kg_saved": 2.3,
  "walk_trips": 3,
  "byo": 1,
  "streak": 4,
  "rank": { "rank": 3, "of": 24 },
  "under_budget_kg": 2.1
}
```

### Fields

- **`week_end`:** `week_start + 7 days` for last week, or `now` for this week.
- **`first_name`:** the first word of the display name. It is the only name on the card.
- **`empty`:** true when the student has no activity in the range. All the counts are then 0 and the optional fields are null.
- **`points`:** activity points plus mission bonuses in the range. It uses the same `periodPoints` as Ranks, so it matches the leaderboard and Today.
- **`verified_meals`, `low_carbon_meals`:** stall-verified meals only, as in insights §3.
- **`kg_saved`:** `kgSaved(the student's activity in range, averageMealKg(menu))` from `src/worker/lib/insights.ts`. It is labelled as an estimate on the card.
- **`walk_trips`, `byo`:** the same definitions as insights §3.
- **`streak`:** `streak(times, at)`, where:
  - `at` is `week_end − 1` for last week, so the streak counts as of the end of that week;
  - `at` is `now` for this week.
- **`rank`:** the student's place in that range's standings, from the same function as Ranks.
  - `of` is the number of ranked students, those with more than 0 points.
  - It is `null` if the student isn't ranked.
- **`under_budget_kg`:** last week only.
  - It is `target − last_week` from `computeBudget` when all of these hold:
    - the budget was ready before that week started (insights §3);
    - the student logged at least one activity with a kg that week;
    - the result is greater than 0.
  - Otherwise it is null.
  - It is always null for this week, because a part-week is trivially under.
  - The card never shows "over budget".

## 5. Screens

### 5.1 Today entry

- A slim card below the week dots: "Your week in review →" with the week's dates.
- It appears when the student has any activity last week or this week. `/me/summary` gains `recap_ready: boolean` for this.
- `/recap` opens on Last week. If last week is empty and this week isn't (for example, a student's first week), it opens on This week so far instead.
- Tapping it opens `/recap`.

### 5.2 `/recap`

- A student screen with the tab bar hidden, like `/claim`.
- **Layout:**
  - a back link
  - the switch (segmented control)
  - a preview: the drawn PNG as an `<img>`, scaled to fit with rounded corners
  - **Share** (primary) and **Download** (secondary)
- **Share:**
  - It uses `navigator.share({ files: [png] })` when `navigator.canShare({ files })` is true.
  - Otherwise only Download shows. It is an `<a download="campus-carbon-week.png">`.
- **Empty week:** the preview area shows "Nothing logged that week" and the buttons are hidden.
- **Cancelling** the share sheet (an `AbortError`) shows no error.

### 5.3 The card image (1080 × 1920 PNG, drawn with Canvas 2D on the phone)

- **Background:** off-white `#f7f6f2`. The fonts are the app's serif and sans stacks, and the one accent is green `#2e7d50`.
- **Top to bottom:**
  1. "CAMPUS CARBON" eyebrow, then `<first name> · 28 Sep – 4 Oct`. This week shows "this week so far".
  2. **Headline:** a serif number, `185`, labelled "points". For last week: "points last week".
  3. **Panels in a 2 × 2 grid:**
     - "4 of 6" — low-carbon meals
     - "≈ 2.3 kg" — CO₂e saved (est.)
     - "3" — walks
     - "1" — own cups and containers
  4. **One line for each that applies:** "4-day streak" when the streak is at least 2; "#3 of 24 last week" (or "currently #3 of 24"); "2.1 kg under my budget".
  5. **Footer:**
     - "Join at" plus the app's host
     - a QR code to `https://<host>/` (the `qrcode` package, drawn onto the canvas)
     - small print: "kg saved is an estimate vs an average campus meal"
- **Drawing order:** the image is drawn after `document.fonts.ready`, so the serif renders.
- **Platform text:** no emoji and no platform-specific glyphs, so the PNG looks the same on every phone.

## 6. Privacy

- The card shows only the student's own first name and numbers.
- The rank shows positions, never other students' names.
- Nothing is uploaded: the image exists only on the phone until the student shares it.

## 7. Testing

**Unit tests:** a pure `recap()` builder in `src/worker/lib/recap.ts`, taking rows and timestamps:
- an empty week gives `empty: true` with null optional fields
- `under_budget_kg` is null for this week, and null when over budget
- `under_budget_kg` is positive when under, and null when the budget wasn't ready before the week
- the streak is counted as of the week's end
- `first_name` is the first word

**Route tests:**
- 403 for a seller and an admin
- `points` equals `/api/leaderboard`'s points for the student (this week)
- the response contains no other student's name or id
- `week=bogus` acts as `last`
- `/me/summary` returns `recap_ready`

**Browser check:**
- Today shows the entry
- `/recap` renders the preview at 375 px
- the switch changes the card
- Download saves a 1080 × 1920 PNG

**Real phone (checklist):** Share → Instagram Story and WhatsApp on iPhone and Android.

## 8. Build notes

- Reuse rather than re-derive:
  - `periodPoints` and `rank` (leaderboard)
  - `standings` (acts.ts)
  - `kgSaved` and `averageMealKg` (insights)
  - `computeBudget`
  - `streak`
  - `loadMissionPoints`
  - `sgWeekStart`
- Drawing code lives in `src/app/recapImage.ts` as `drawRecap(data, origin): Promise<Blob>`, so the screen stays small.
