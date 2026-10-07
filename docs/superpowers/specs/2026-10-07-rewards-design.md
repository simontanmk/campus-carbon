# Rewards: Design

Date: 2026-10-07. This extends the main spec (`2026-09-29-campus-carbon-app-design.md`). It is the third of three new-feature specs, after insights and impact and the weekly recap card.

## 1. Goal

Students spend points on real perks at canteen stalls.

Success means:
- A student taps Redeem, shows a code, and the seller confirms it on the stall phone in under 15 seconds.
- Points can never be spent twice.
- The leaderboard is unaffected.

## 2. Scope

**Phase 1 (this spec's plan):**
- an admin-managed rewards catalogue
- a spendable balance
- 6-character redemption codes with a 10-minute hold
- seller confirmation by typing the code
- a student Rewards tab (the 5th tab)
- an admin rewards editor and a redemptions CSV

**Phase 2 (a later plan):**
- the code is also shown as a QR code
- the seller's screen gets **Scan**, using the camera
- confirming a scanned code works exactly as typing it (§6.2)

**Out:**
- cash value or payments
- transferring points between students
- cancelling a redemption after the seller confirms it
- reward images

## 3. Points to spend

- **Earned:** the lifetime total Today shows as `points_total`, meaning activity points plus mission bonuses resolved per week (`missionPoints(acts, 0, now + 1, missionPoints)`).
- **Spent:** the sum of `cost` over the student's redemptions that are `redeemed`, or `pending` and not yet expired.
- **Balance = earned − spent.**
  - It never goes below 0, because issuing a code is atomic (§6.1).
  - Earned only grows, since activities are never deleted. A balance checked against a slightly stale earned figure therefore never over-spends.
- **Ranks, Today's points and missions are unchanged.** Spending only lowers the balance.

## 4. Data (migration `0004_rewards.sql`)

```sql
CREATE TABLE rewards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cost INTEGER NOT NULL CHECK (cost > 0),
  stall_id TEXT REFERENCES stalls(id),          -- NULL = any stall
  weekly_stock INTEGER CHECK (weekly_stock IS NULL OR weekly_stock >= 0), -- NULL = unlimited
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE redemptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  reward_id TEXT NOT NULL REFERENCES rewards(id),
  code TEXT NOT NULL,                            -- 6 chars, stored without the dash
  cost INTEGER NOT NULL,                         -- copied from the reward when issued
  status TEXT NOT NULL CHECK (status IN ('pending','redeemed','expired')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  redeemed_at INTEGER,
  stall_id TEXT REFERENCES stalls(id)            -- the stall that confirmed it
);
CREATE UNIQUE INDEX redemptions_one_pending ON redemptions (user_id) WHERE status = 'pending';
CREATE UNIQUE INDEX redemptions_pending_code ON redemptions (code) WHERE status = 'pending';
CREATE INDEX redemptions_user ON redemptions (user_id, created_at);
CREATE INDEX redemptions_reward ON redemptions (reward_id, created_at);
```

- **Lapsed holds:** a `pending` row whose `expires_at` has passed counts as lapsed everywhere, so its points are free again.
- **Clearing lapsed rows:** before any new code is issued, `UPDATE … SET status = 'expired'` runs on lapsed `pending` rows. This stops a lapsed row blocking the two partial unique indexes.

**Seed** (`ON CONFLICT DO NOTHING`, so admin edits survive re-seeding):

| id | name | cost | stall | weekly stock |
|---|---|---|---|---|
| `free-kopi` | Free kopi | 150 | drinks | 20 |
| `egg-addon` | Free egg add-on | 80 | econ-rice | NULL |
| `dollar-off-low` | $1 off a low-carbon meal | 200 | any | 30 |

## 5. Codes

- **Alphabet:** `ABCDEFGHJKMNPQRSTUVWXYZ23456789`. This leaves out I, L, O, 0 and 1.
- **Length:** 6 characters, from `crypto.getRandomValues`.
- **Display:** `K7P-Q2M`.
- **Input normalisation:** uppercase, then remove anything outside the alphabet. So `k7p q2m` and `K7P-Q2M` both match.
- **Collisions:** if the code collides with another pending code (the unique index), generate a new one, up to 3 tries. If all 3 fail, answer 503.

## 6. Flows and endpoints

### 6.1 Student issues a code: `POST /api/rewards/:id/redeem` (student)

1. Load the reward. If it's missing or inactive: 404 `no_reward`.
2. Mark the student's lapsed pendings as expired. Then, if the student still has a live pending code: 409 `already_pending`, "Use or cancel your current code first."
3. Compute `earned` (§3) and the SGT week start.
4. Generate the code. Then run one statement:
   ```sql
   INSERT INTO redemptions (id, user_id, reward_id, code, cost, status, created_at, expires_at)
   SELECT ?id, ?uid, r.id, ?code, r.cost, 'pending', ?now, ?now + 600000 FROM rewards r
   WHERE r.id = ?rid AND r.active = 1
     AND ?earned - (SELECT COALESCE(SUM(cost),0) FROM redemptions
                    WHERE user_id = ?uid AND (status = 'redeemed' OR (status = 'pending' AND expires_at > ?now))) >= r.cost
     AND (r.weekly_stock IS NULL OR (SELECT COUNT(*) FROM redemptions
                    WHERE reward_id = r.id AND created_at >= ?week
                      AND (status = 'redeemed' OR (status = 'pending' AND expires_at > ?now))) < r.weekly_stock)
   ```
5. If no row was inserted, diagnose the reason:
   - **Out of stock** (the stock count is ≥ stock): 409 `out_of_stock`, "All gone this week. Back on Monday."
   - **Not enough points:** 409 `insufficient`, "You need N more points."
   - **A unique-index error on user_id** (two taps at once): 409 `already_pending`.
6. On success it answers 201 with `{ id, code, reward_name, cost, expires_at, server_now }`.

Hold length: 10 minutes. It's a constant (`HOLD_MS = 600000`), not a setting.

### 6.2 Seller confirms: `POST /api/stall/redeem` (seller), body `{ code }`

1. Normalise the code (§5). Anything that isn't 6 characters: 400 `invalid_code`, "Codes are 6 letters and numbers."
2. Run one statement:
   ```sql
   UPDATE redemptions SET status = 'redeemed', redeemed_at = ?now, stall_id = ?stall
   WHERE code = ?code AND status = 'pending' AND expires_at > ?now
     AND reward_id IN (SELECT id FROM rewards WHERE stall_id IS NULL OR stall_id = ?stall)
   ```
3. On exactly 1 change: 200 `{ reward_name, student_name, cost }`. The student name is the first word only.
4. Otherwise, look up the newest redemption with that code and answer with the reason:
   - **none:** 404 `not_found`, "No reward with that code. Check the letters with the student."
   - **redeemed:** 409 `used`, "This code has already been used."
   - **lapsed or expired:** 410 `expired`, "This code has expired. Ask the student to tap Redeem again."
   - **another stall:** 403 `wrong_stall`, "This reward is for <stall name>."
5. Only the first of two confirms wins, because of the `status = 'pending'` condition.

### 6.3 Student endpoints

- **`GET /api/rewards`** returns:
  - `{ balance, earned, spent }`
  - `rewards`: `[{ id, name, cost, stall_name | null, left_this_week | null, affordable }]` for active rewards, ordered by cost
  - `active`: the live pending code as `{ id, code, reward_name, cost, expires_at, server_now }`, or `null`
  - `history`: the last 10 redemptions that were `redeemed`, as `{ reward_name, cost, redeemed_at, stall_name }`
- **`GET /api/rewards/redemptions/:id`** (owner only) returns `{ status: "pending" | "redeemed" | "expired" }`. A lapsed pending reads as `"expired"`. The student's code screen polls it every 2 s.
- **`POST /api/rewards/redemptions/:id/cancel`** (owner only, pending only) sets `status = 'expired'` and frees the points at once. It returns `{ cancelled: true }`.

### 6.4 Admin endpoints

- **`GET /api/admin/rewards`**: every reward, plus `redeemed_this_week` and `pending_now`.
- **`POST /api/admin/rewards`**: creates a reward from `{ name, cost, stall_id | null, weekly_stock | null, active }`.
  - The id is a slug of the name plus 4 random hex characters.
  - Checks: name 1–60 characters; `cost` a whole number from 1 to 100,000; `stall_id` an existing stall or null; `weekly_stock` null or a whole number from 0 to 10,000.
  - Anything else: 400 `invalid_reward`.
- **`POST /api/admin/rewards/:id`**: edits any of those fields. There's no delete, so history is kept; use `active: false` instead.
  - A cost change only applies to codes issued afterwards, because issued codes keep their own `cost`.
- **`GET /api/admin/redemptions.csv`**: `redemption_id, user_id, reward_id, reward_name, cost, status, code, created_at_sgt, expires_at_sgt, redeemed_at_sgt, stall_id, week_start_sgt`. Lapsed pendings show as `expired`, and cells are neutralised against spreadsheet formulas the same way as the activity export (`toCsv`).

## 7. Screens

### 7.1 Rewards tab (student, `/rewards`)

- **TabBar:** Today, Log, Missions, Ranks, Rewards.
- **Header:** a serif balance, "180", labelled "points to spend". Under it, in muted text: "Earned 330 · spent 150. Spending doesn't change your rank."
- **The live code** (when `active` is set), as a card at the top:
  - the reward name
  - the code in large monospace type, `K7P-Q2M`
  - "Show this to the seller · 9:41 left" (the countdown uses the server-clock offset, as on the seller's sheet)
  - a **Cancel** link
  - Polling every 2 s; on `redeemed` the card turns into "Redeemed ✓ <reward>" with the balance refreshed, and on `expired` it disappears and the balance refreshes.
- **Reward list:** rows showing the name, the stall ("Drinks" or "Any stall"), the cost, and "12 left this week" when stocked.
  - The **Redeem** button is disabled with a reason: "Need 20 more", "All gone this week", or "Use your current code first".
- **History:** "Redeemed" rows with the date and stall.

### 7.2 Seller (stall screen)

- A **Redeem a reward** secondary button below the item grid opens a sheet.
- The sheet has a code input (`autocapitalize="characters"`, `inputmode="text"`, max 7 characters including the dash) and **Confirm**.
- **Success:** a check mark, "Free kopi for Simon", and Done.
- **Errors:** the server's message, shown inline.

### 7.3 Admin

- An admin-hub button **Rewards** opens `/admin/rewards`. It shows:
  - a list of rewards with cost, stall, stock, active, and this week's redemptions
  - inline editing of the same fields
  - an add form
  - **Download redemptions (CSV)**

## 8. Security

- **Who can do what:**
  - every endpoint checks its role
  - students only see and cancel their own redemptions
  - sellers confirm through the stall bound to their session, never a parameter
- **Codes are short-lived, single-use and limited to one stall.** A seller can try codes, but sellers are trusted and every confirm is logged with its stall. Rate-limiting typed codes is deferred to Phase 2.
- **No double-spending:** the balance and stock checks run inside the INSERT (§6.1), and the partial unique index allows one live code per student.

## 9. Testing

**Unit tests:** code generation and normalisation (alphabet, length, dash and case handling).

**Route tests:**
- issuing a code puts the points on hold; the balance can't go negative
- two redeems at the same moment produce one code
- stock is enforced, including two students racing for the last one
- a hold lapses and the points come back
- cancel frees the points
- seller confirms: right stall, any-stall reward, wrong stall (403), used (409), expired (410), unknown (404), and two confirms at once (one wins)
- leaderboard points are unchanged after spending
- admin create, edit and validation; non-admins get 403
- the CSV has its header, and a lapsed pending shows as expired

**Browser check:** the Rewards tab at 375 px (balance, list, live code, countdown, cancel), the seller's redeem sheet, and the admin editor.

## 10. Phase 2 note (QR scanning)

- The code screen will also render `code` as a QR (`qrcode`).
- The seller's sheet gains **Scan**. It uses `BarcodeDetector` where available, and otherwise a small decoding library (for example `jsQR`) loaded on demand, then calls the same §6.2 endpoint.
- No server changes.
