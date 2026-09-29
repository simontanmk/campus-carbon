# Stage 2a: Mobility, Waste and Weekly Budget — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Students can log campus trips (walk / shuttle / car-Grab, with real walking distances), steps and container returns as self-reported activities, capped per day.
- Home shows a weekly carbon budget built from each student's own first week.
- Seeded personas arrive with a realistic history, so the budget is visible in the demo.

**Architecture:**
- Mobility maths, the self-reported cap and the budget are pure modules in `src/worker/lib/`, unit-tested.
- A new `log` route file exposes locations, trip options and the three logging endpoints.
- Routes are generated once from OpenStreetMap (OSRM foot and car profiles) into a committed JSON file that the seed loads.
- The seed becomes conflict-safe, so it can be re-run on the live database without clobbering accounts, settings or activity.

**Tech Stack:** same as Stage 1 (Hono 4, D1, React 19, Vite 8, Vitest 5, Node 25). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-29-campus-carbon-app-design.md` (§3, §7, §8.3, §8.4, §10, §14)

**Follows:** Stage 1 (merged). **Next:** Stage 2b (missions, streaks, badges, leaderboard) gets its own plan.

## Global Constraints

- **Self-reported points** (spec §7):
  - walk trip +10
  - shuttle trip +5
  - car/Grab trip 0
  - container return +5 each
  - step entry 0
- **Daily cap:** self-reported points are capped at `self_reported_daily_cap` = 30 per SG day. An action over the cap is still logged, with its points reduced (possibly to 0).
- **Every self-reported activity** has `verified = 0`, `source = 'manual'`.
- **Trip kg:**
  - walk = 0
  - shuttle / car = `distance_km × factor`, rounded to 2 dp
  - a pending factor (`kg_per_unit IS NULL`) → `kg_co2e = NULL`, never 0 (spec §6)
- **Mobility factors (kg CO2e per passenger-km)**, from UK DESNZ 2022 via Our World in Data "Carbon footprint of travel per kilometer" (`ourworldindata.org/grapher/carbon-footprint-travel-mode`):
  - `car` = 0.1705 ("Petrol car", also used for Grab)
  - `shuttle` = 0.0965 ("Bus (average)", a cautious proxy: NTU's fleet is being electrified but is not fully electric)
- **Weekly budget** (spec §10):
  - baseline = total kg in the student's first 7 days after `created_at`, per category and overall
  - target = baseline × 0.85, never a fixed number
  - weeks run Monday to Sunday, Asia/Singapore
- **Waste actions** (BYO, returns) have `kg_co2e = NULL`. Budget sums skip NULL.
- **Errors:** every error body is `{ error, message }`. No 500s for bad input.
- **Design** (approved in session): off-white `#f7f6f2`, grey panels `#ecebe6`, serif headings and numbers, one green accent, glass only on floating chrome (the tab bar).
- **Stage 1 constraints** still hold (timestamps in ms, booleans bound as 0/1, IDs, no Web NFC).

## Review Focus

1. **A student logs a fourth walk on the same day.** The trip is logged, but points stop at the 30-point cap. Pinned in Task 5.
2. **A trip from a place to itself, an unknown place, or an unknown mode.** Returns 400 with a plain message, not 500. Pinned in Task 5.
3. **A factor is still pending (NULL).** The trip option shows `kg_co2e: null`, and the logged activity stores NULL, not 0. Pinned in Tasks 3 and 5.
4. **A brand-new student (under 7 days old) or a student whose first week had no kg.** The budget reports "not ready" without dividing by zero or showing NaN. Pinned in Task 4.
5. **Steps or returns given as a string, negative, zero, decimal, or absurdly large.** Returns 400. Pinned in Task 5.
6. **Re-running the seed on the live DB after real use.** It keeps users' `created_at`, admin roles, stall `active` flags, item `status` and settings, and doesn't duplicate persona history. Pinned in Task 1.

---

## File Structure

```
migrations/0002_mobility.sql         locations.lat/lon, routes.car_min, routes.source
seed/data.ts                         (modify) mobility factors, LOCATIONS, PERSONA_HISTORY
seed/sql.ts                          (modify) conflict-safe upserts, locations, routes, persona history
seed/fetch-routes.ts                 CLI: OSRM foot + car for every location pair → seed/routes.json
seed/routes.json                     generated, committed
src/worker/lib/mobility.ts           tripOptions, Mode
src/worker/lib/scoring.ts            (modify) capSelfReported
src/worker/lib/budget.ts             computeBudget, Budget
src/worker/routes/log.ts             /locations, /trips/options, /trips, /steps, /returns
src/worker/routes/me.ts              (modify) budget + recent.detail in /me/summary
src/worker/app.ts                    (modify) mount log routes
src/app/api.ts                       (modify) shared types for new endpoints
src/app/components/TabBar.tsx        glass bottom tab bar (Today, Log)
src/app/screens/Log.tsx              trip planner, steps, container returns
src/app/screens/Home.tsx             (modify) budget in grey panel, category line, recent labels
src/app/copy.ts                      (modify) activityLabel, budgetLine
src/app/App.tsx                      (modify) /log route + tab bar for students
src/app/styles.css                   (modify) tab bar, select, option cards, stepper
test/seed.test.ts                    (modify)
test/mobility.test.ts, test/budget.test.ts, test/log.test.ts
test/me.test.ts, test/copy.test.ts, test/scoring.test.ts   (modify)
```

---

### Task 1: Conflict-safe seed, mobility factors, locations and persona history

**Files:**
- Create: `migrations/0002_mobility.sql`
- Modify: `seed/data.ts`, `seed/sql.ts`, `test/seed.test.ts`

**Interfaces:**
- Produces:
  - `buildSeedSql(now?: number): string`. Now idempotent without clobbering. Stage 1 callers are unchanged.
  - Seeded location ids: `hive`, `north-spine`, `south-spine`, `hall-11`, `src`, `canteen-2`, `lwn-library`.
  - Persona history rows with ids `seed-<user>-<n>`.

- [ ] **Step 1: Write the migration** `migrations/0002_mobility.sql`

```sql
ALTER TABLE locations ADD COLUMN lat REAL;
ALTER TABLE locations ADD COLUMN lon REAL;
ALTER TABLE routes ADD COLUMN car_min REAL;
ALTER TABLE routes ADD COLUMN source TEXT;
```

- [ ] **Step 2: Write the failing tests.** In `test/seed.test.ts`, replace the "seeds mobility factors as pending (null)" test and add the tests below. Keep the others.

```ts
  it("seeds sourced mobility factors (kg per passenger-km)", () => {
    const { raw } = seeded();
    const f = raw.prepare("SELECT key, kg_per_unit, unit FROM factors WHERE unit='pkm' ORDER BY key").all();
    expect(f).toEqual([
      { key: "car", kg_per_unit: 0.1705, unit: "pkm" },
      { key: "shuttle", kg_per_unit: 0.0965, unit: "pkm" },
    ]);
  });

  it("seeds seven campus locations with coordinates", () => {
    const { raw } = seeded();
    const rows = raw.prepare("SELECT id, lat, lon FROM locations ORDER BY id").all() as any[];
    expect(rows.map((r) => r.id)).toEqual(["canteen-2", "hall-11", "hive", "lwn-library", "north-spine", "south-spine", "src"]);
    expect(rows.every((r) => r.lat > 1.3 && r.lat < 1.4 && r.lon > 103.6 && r.lon < 103.7)).toBe(true);
  });

  it("re-seeding keeps live edits and does not duplicate history", () => {
    const { raw } = seeded();
    raw.exec("UPDATE users SET role='admin', created_at=123 WHERE id='u-bea'");
    raw.exec("UPDATE stalls SET active=0 WHERE id='drinks'");
    raw.exec("UPDATE items SET status='draft', points=7 WHERE id='kopi'");
    raw.exec("UPDATE settings SET value='50' WHERE key='rate_daily_max'");
    raw.exec("UPDATE factors SET kg_per_unit=999 WHERE key='rice'");
    const before = (raw.prepare("SELECT COUNT(*) AS n FROM activities").get() as any).n;
    raw.exec(buildSeedSql(Date.UTC(2026, 9, 20)));
    expect(raw.prepare("SELECT role, created_at FROM users WHERE id='u-bea'").get()).toEqual({ role: "admin", created_at: 123 });
    expect((raw.prepare("SELECT active FROM stalls WHERE id='drinks'").get() as any).active).toBe(0);
    expect(raw.prepare("SELECT status, points FROM items WHERE id='kopi'").get()).toEqual({ status: "draft", points: 7 });
    expect((raw.prepare("SELECT value FROM settings WHERE key='rate_daily_max'").get() as any).value).toBe("50");
    expect((raw.prepare("SELECT kg_per_unit FROM factors WHERE key='rice'").get() as any).kg_per_unit).toBe(4.45);
    expect((raw.prepare("SELECT COUNT(*) AS n FROM activities").get() as any).n).toBe(before);
    expect(raw.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("gives each persona a baseline week and a last week, anchored to their created_at", () => {
    const { raw } = seeded();
    const DAY = 86_400_000;
    for (const id of ["u-alex", "u-bea", "u-chen"]) {
      const created = (raw.prepare("SELECT created_at FROM users WHERE id=?").get(id) as any).created_at;
      const rows = raw.prepare("SELECT created_at, kg_co2e FROM activities WHERE user_id=?").all(id) as any[];
      const firstWeek = rows.filter((r) => r.created_at >= created && r.created_at < created + 7 * DAY);
      const secondWeek = rows.filter((r) => r.created_at >= created + 7 * DAY && r.created_at < created + 14 * DAY);
      expect(firstWeek.length).toBeGreaterThan(3);
      expect(secondWeek.length).toBeGreaterThan(3);
    }
  });

  it("Alex's baseline is heavier than Chen's", () => {
    const { raw } = seeded();
    const kg = (id: string) => (raw.prepare("SELECT SUM(kg_co2e) AS k FROM activities WHERE user_id=?").get(id) as any).k;
    expect(kg("u-alex")).toBeGreaterThan(kg("u-chen") * 2);
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run test/seed.test.ts`
Expected: the new tests FAIL (factors are null, there are no locations, and REPLACE overwrites the edits).

- [ ] **Step 4: Update `seed/data.ts`.** Replace the two `shuttle` / `car` entries in `FACTORS`, then append `LOCATIONS` and `PERSONA_HISTORY`.

```ts
  { key: "shuttle", kg_per_unit: 0.0965, unit: "pkm", source: "UK DESNZ (2022) via Our World in Data: Bus (average)", note: "proxy; NTU shuttle fleet is being electrified, so the true value is lower" },
  { key: "car", kg_per_unit: 0.1705, unit: "pkm", source: "UK DESNZ (2022) via Our World in Data: Petrol car", note: "per km, single occupant; also used for Grab" },
```

```ts
/** Coordinates from OpenStreetMap Nominatim, 2026-09-29. */
export const LOCATIONS = [
  { id: "hive", name: "The Hive", lat: 1.3432338, lon: 103.6827372 },
  { id: "north-spine", name: "North Spine", lat: 1.3464737, lon: 103.680889 },
  { id: "south-spine", name: "South Spine", lat: 1.3432754, lon: 103.6812359 },
  { id: "hall-11", name: "Hall 11", lat: 1.3544176, lon: 103.6869773 },
  { id: "src", name: "Sports and Recreation Centre", lat: 1.3485623, lon: 103.6888668 },
  { id: "canteen-2", name: "Canteen 2", lat: 1.3483769, lon: 103.6854467 },
  { id: "lwn-library", name: "Lee Wee Nam Library", lat: 1.347689, lon: 103.6809281 },
] as const;

/**
 * Demo history. day = days after the persona's created_at (0–13), hour = SGT-ish hour offset.
 * Days 0–6 form the budget baseline; days 7–13 are "last week" for the demo.
 * kind "meal"/"drink" reference seeded items; "trip" uses a route and mode.
 */
export type HistoryEntry =
  | { day: number; hour: number; kind: "meal" | "drink"; item: string; byo?: boolean }
  | { day: number; hour: number; kind: "trip"; from: string; to: string; mode: "walk" | "shuttle" | "car" };

const meatHeavy: HistoryEntry[] = [
  { day: 0, hour: 12, kind: "meal", item: "chicken-rice" },
  { day: 1, hour: 12, kind: "meal", item: "fish-soup" },
  { day: 1, hour: 9, kind: "trip", from: "hall-11", to: "north-spine", mode: "car" },
  { day: 2, hour: 12, kind: "meal", item: "econ-pork" },
  { day: 3, hour: 12, kind: "meal", item: "chicken-rice" },
  { day: 3, hour: 9, kind: "trip", from: "hall-11", to: "south-spine", mode: "car" },
  { day: 4, hour: 12, kind: "meal", item: "beef-hor-fun" },
  { day: 5, hour: 12, kind: "meal", item: "econ-chicken" },
  { day: 8, hour: 12, kind: "meal", item: "chicken-rice" },
  { day: 8, hour: 9, kind: "trip", from: "hall-11", to: "north-spine", mode: "shuttle" },
  { day: 9, hour: 12, kind: "meal", item: "econ-veg-egg" },
  { day: 10, hour: 12, kind: "meal", item: "fish-soup" },
  { day: 11, hour: 9, kind: "trip", from: "hall-11", to: "hive", mode: "car" },
  { day: 12, hour: 12, kind: "meal", item: "wanton-mee" },
];
const mixed: HistoryEntry[] = [
  { day: 0, hour: 12, kind: "meal", item: "econ-veg-tofu" },
  { day: 1, hour: 12, kind: "meal", item: "chicken-rice" },
  { day: 1, hour: 9, kind: "trip", from: "canteen-2", to: "north-spine", mode: "shuttle" },
  { day: 2, hour: 12, kind: "meal", item: "veg-noodles", byo: true },
  { day: 3, hour: 10, kind: "drink", item: "kopi" },
  { day: 4, hour: 12, kind: "meal", item: "econ-fish" },
  { day: 8, hour: 12, kind: "meal", item: "econ-veg-egg" },
  { day: 9, hour: 9, kind: "trip", from: "canteen-2", to: "lwn-library", mode: "walk" },
  { day: 10, hour: 12, kind: "meal", item: "wanton-mee" },
  { day: 11, hour: 12, kind: "meal", item: "veg-noodles", byo: true },
];
const lowCarbon: HistoryEntry[] = [
  { day: 0, hour: 12, kind: "meal", item: "veg-noodles", byo: true },
  { day: 1, hour: 12, kind: "meal", item: "econ-veg-egg" },
  { day: 1, hour: 9, kind: "trip", from: "hive", to: "north-spine", mode: "walk" },
  { day: 2, hour: 12, kind: "meal", item: "econ-veg-tofu" },
  { day: 3, hour: 10, kind: "drink", item: "kopi-o-kosong" },
  { day: 4, hour: 12, kind: "meal", item: "veg-noodles" },
  { day: 8, hour: 12, kind: "meal", item: "econ-veg-egg", byo: true },
  { day: 9, hour: 9, kind: "trip", from: "hive", to: "south-spine", mode: "walk" },
  { day: 10, hour: 12, kind: "meal", item: "veg-noodles" },
  { day: 11, hour: 12, kind: "meal", item: "econ-chicken" },
];

export const PERSONA_HISTORY: Record<string, HistoryEntry[]> = {
  "u-alex": meatHeavy,
  "u-bea": mixed,
  "u-chen": lowCarbon,
};
```

- [ ] **Step 5: Rewrite `seed/sql.ts`**

```ts
import { computeKg, isLowCarbonMeal, type FactorTable } from "../src/worker/lib/carbon.ts";
import { DEFAULT_SETTINGS } from "../src/worker/lib/settings.ts";
import { FACTORS, ITEMS, LOCATIONS, PERSONA_HISTORY, SETTINGS, STALLS, USERS } from "./data.ts";
import routes from "./routes.json" with { type: "json" };

type Val = string | number | null;
type Route = { from_id: string; to_id: string; distance_km: number; walk_min: number; car_min: number; shuttle_min: number };

const DAY = 86_400_000;
const HOUR = 3_600_000;

function lit(v: Val): string {
  if (v === null) return "NULL";
  if (typeof v === "number") return String(v);
  return `'${v.replace(/'/g, "''")}'`;
}

/** INSERT … ON CONFLICT: `update` lists the seed-owned columns; an empty list means DO NOTHING. */
function upsert(table: string, row: Record<string, Val>, conflict: string[], update: string[]): string {
  const cols = Object.keys(row);
  const action = update.length ? `DO UPDATE SET ${update.map((c) => `${c} = excluded.${c}`).join(", ")}` : "DO NOTHING";
  return `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((c) => lit(row[c])).join(", ")}) ON CONFLICT(${conflict.join(", ")}) ${action};`;
}

export function buildSeedSql(now: number = Date.now()): string {
  const factorTable: FactorTable = Object.fromEntries(FACTORS.filter((f) => f.unit === "kg").map((f) => [f.key, f.kg_per_unit]));
  const factorOf = (k: string) => FACTORS.find((f) => f.key === k)!.kg_per_unit;
  const created = now - 14 * DAY;
  const out: string[] = [];

  for (const f of FACTORS) out.push(upsert("factors", { ...f }, ["key"], ["kg_per_unit", "unit", "source", "note"]));
  for (const s of STALLS) out.push(upsert("stalls", { ...s, active: 1 }, ["id"], ["name", "canteen"]));
  for (const u of USERS) out.push(upsert("users", { ...u, created_at: created }, ["id"], []));
  const itemKg = new Map<string, { kg: number | null; low: number; stall: string; kind: string }>();
  for (const i of ITEMS) {
    const kg = i.kg_override ?? computeKg(i.parts, factorTable);
    const low = i.kind === "meal" && isLowCarbonMeal(i.parts) ? 1 : 0;
    itemKg.set(i.id, { kg, low, stall: i.stall_id, kind: i.kind });
    out.push(
      upsert(
        "items",
        { id: i.id, stall_id: i.stall_id, name: i.name, kind: i.kind, parts_json: JSON.stringify(i.parts), kg_co2e: kg, low_carbon: low, points: null, status: "live" },
        ["id"],
        ["stall_id", "name", "kind", "parts_json", "kg_co2e", "low_carbon"],
      ),
    );
  }
  for (const [key, value] of Object.entries(SETTINGS)) out.push(upsert("settings", { key, value: String(value) }, ["key"], []));
  for (const l of LOCATIONS) out.push(upsert("locations", { ...l }, ["id"], ["name", "lat", "lon"]));
  for (const r of routes as Route[]) {
    out.push(
      upsert(
        "routes",
        { ...r, placeholder: 0, source: "OpenStreetMap via OSRM (routing.openstreetmap.de); shuttle = drive + 5 min wait" },
        ["from_id", "to_id"],
        ["distance_km", "walk_min", "shuttle_min", "car_min", "placeholder", "source"],
      ),
    );
  }

  // Persona history, anchored to each persona's own created_at so re-seeding never shifts it.
  const findRoute = (a: string, b: string) =>
    (routes as Route[]).find((r) => (r.from_id === a && r.to_id === b) || (r.from_id === b && r.to_id === a));
  for (const [uid, entries] of Object.entries(PERSONA_HISTORY)) {
    entries.forEach((e, n) => {
      const at = `(SELECT created_at FROM users WHERE id = ${lit(uid)}) + ${e.day * DAY + e.hour * HOUR}`;
      const id = `seed-${uid}-${n}`;
      let cols: Record<string, Val>;
      if (e.kind === "trip") {
        const route = findRoute(e.from, e.to);
        if (!route) throw new Error(`no route ${e.from} → ${e.to}`);
        const factor = e.mode === "walk" ? 0 : factorOf(e.mode);
        const kg = factor == null ? null : Math.round(route.distance_km * factor * 100) / 100;
        const points = e.mode === "walk" ? DEFAULT_SETTINGS.points_walk_trip : e.mode === "shuttle" ? DEFAULT_SETTINGS.points_shuttle_trip : 0;
        cols = { id, user_id: uid, category: "mobility", type: "trip", kg_co2e: kg, points, verified: 0, source: "manual", stall_id: null, item_id: null, low_carbon: null, detail_json: JSON.stringify({ from_id: e.from, to_id: e.to, mode: e.mode, distance_km: route.distance_km }) };
      } else {
        const it = itemKg.get(e.item)!;
        const low = e.kind === "meal" ? it.low : null;
        const points = e.kind === "meal" && it.low === 1 ? DEFAULT_SETTINGS.points_meal_low_carbon : 0;
        cols = { id, user_id: uid, category: "food", type: e.kind, kg_co2e: it.kg, points, verified: 1, source: "qr", stall_id: it.stall, item_id: e.item, low_carbon: low, detail_json: "{}" };
      }
      out.push(historyInsert(cols, at));
      if (e.kind !== "trip" && e.byo) {
        const it = itemKg.get(e.item)!;
        out.push(historyInsert({ id: `${id}-byo`, user_id: uid, category: "waste", type: "byo", kg_co2e: null, points: DEFAULT_SETTINGS.points_byo, verified: 1, source: "qr", stall_id: it.stall, item_id: null, low_carbon: null, detail_json: "{}" }, at));
      }
    });
  }

  return out.join("\n") + "\n";
}

function historyInsert(cols: Record<string, Val>, createdAtExpr: string): string {
  const names = [...Object.keys(cols), "created_at"];
  const values = [...Object.values(cols).map(lit), createdAtExpr];
  return `INSERT INTO activities (${names.join(", ")}) SELECT ${values.join(", ")} WHERE EXISTS (SELECT 1 FROM users WHERE id = ${lit(cols.user_id as string)}) ON CONFLICT(id) DO NOTHING;`;
}
```

This task needs `seed/routes.json`. Do not hand-write distances. Create `seed/fetch-routes.ts` exactly as in Task 2 Step 3, add the `seed:routes` script to `package.json`, and run `npm run seed:routes` now (network; about 1 minute). Task 2 then pins the generated file with its test and commits the generator.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run test/seed.test.ts`
Expected: PASS

Run: `npx vitest run`
Expected: all PASS once Stage 1 tests that count or read activities for `u-alex` / `u-bea` are scoped to the rows they create. Those tests are in `test/claim.test.ts` ("awards low-carbon meal + BYO", "records a drink with unknown kg", "exactly one wins") and `test/me.test.ts`. Filter with `token_id IS NOT NULL`, or switch to a fresh `POST /api/session` student. Note: the claim rate-limit tests use `u-alex` and `u-bea`. Their seeded history is 2+ days old, so the "today" and "10-minute" windows are unaffected.

- [ ] **Step 7: Commit**

```bash
git add migrations/0002_mobility.sql seed package.json test/seed.test.ts
git commit -m "feat(seed): conflict-safe seed, sourced mobility factors, locations, persona history"
```

---

### Task 2: Generate real campus routes from OpenStreetMap

**Files:**
- Create: `seed/fetch-routes.ts`
- Modify: `seed/routes.json` (generated), `package.json` (script)
- Test: `test/seed.test.ts` (add one test)

**Interfaces:**
- Consumes: `LOCATIONS` (Task 1)
- Produces: `seed/routes.json`, one entry per unordered pair (21 for 7 locations), `from_id < to_id` alphabetically, with `distance_km` (walking, 2 dp), `walk_min`, `car_min` and `shuttle_min` (all 1 dp).

- [ ] **Step 1: Write the failing test** (append to `test/seed.test.ts`)

```ts
  it("seeds a walking route for every pair of locations", () => {
    const { raw } = seeded();
    const rows = raw.prepare("SELECT from_id, to_id, distance_km, walk_min, car_min, shuttle_min, placeholder FROM routes").all() as any[];
    expect(rows).toHaveLength(21);
    for (const r of rows) {
      expect(r.from_id < r.to_id).toBe(true);
      expect(r.distance_km).toBeGreaterThan(0.1);
      expect(r.distance_km).toBeLessThan(5);
      expect(r.walk_min).toBeGreaterThan(r.car_min);
      expect(r.shuttle_min).toBeGreaterThanOrEqual(r.car_min + 5 - 0.05);
      expect(r.placeholder).toBe(0);
    }
  });
```

- [ ] **Step 2: Run it**

Run: `npx vitest run test/seed.test.ts`
Expected: PASS, because the routes were already generated in Task 1. This test pins them, so a later regeneration can't silently drop pairs or break the ordering.

- [ ] **Step 3: Write `seed/fetch-routes.ts`**

```ts
import { writeFileSync } from "node:fs";
import { LOCATIONS } from "./data.ts";

const SHUTTLE_WAIT_MIN = 5; // assumption: average wait for the campus loop; stated in the spec
const UA = { "user-agent": "campus-carbon-prototype (NTU CC0006)" };

async function osrm(profile: "foot" | "car", a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const base = profile === "foot" ? "routed-foot/route/v1/foot" : "routed-car/route/v1/driving";
  const url = `https://routing.openstreetmap.de/${base}/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${profile} ${res.status} for ${url}`);
  const r = (await res.json()).routes[0];
  return { km: r.distance / 1000, min: r.duration / 60 };
}

const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;
const sorted = [...LOCATIONS].sort((a, b) => a.id.localeCompare(b.id));
const out = [];
for (let i = 0; i < sorted.length; i++) {
  for (let j = i + 1; j < sorted.length; j++) {
    const [a, b] = [sorted[i], sorted[j]];
    const walk = await osrm("foot", a, b);
    await new Promise((r) => setTimeout(r, 1100));
    const car = await osrm("car", a, b);
    await new Promise((r) => setTimeout(r, 1100));
    out.push({
      from_id: a.id,
      to_id: b.id,
      distance_km: round(walk.km, 2),
      walk_min: round(walk.min, 1),
      car_min: round(car.min, 1),
      shuttle_min: round(car.min + SHUTTLE_WAIT_MIN, 1),
    });
    console.error(`${a.id} → ${b.id}: ${round(walk.km, 2)} km`);
  }
}
writeFileSync(new URL("./routes.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
```

Add to the `package.json` scripts: `"seed:routes": "node seed/fetch-routes.ts"`.

- [ ] **Step 4: Confirm the generated routes** (already run in Task 1)

Run: `node -e "console.log(require('./seed/routes.json').length)"`
Expected: `21`. If Task 1's run failed or returned fewer, re-run `npm run seed:routes`. If OSRM refuses or times out twice, stop and report. Don't hand-write distances.

- [ ] **Step 5: Check the persona history still resolves.** `seed/sql.ts` finds routes in either direction. Run `npx vitest run`.
Expected: all PASS, including the new routes test.

- [ ] **Step 6: Commit**

```bash
git add seed/fetch-routes.ts seed/routes.json package.json test/seed.test.ts
git commit -m "feat(seed): real walking/driving routes between campus locations from OSRM"
```

---

### Task 3: Mobility options and the self-reported cap

**Files:**
- Create: `src/worker/lib/mobility.ts`, `test/mobility.test.ts`
- Modify: `src/worker/lib/scoring.ts`, `test/scoring.test.ts`

**Interfaces:**
- Consumes: `Settings` (Stage 1)
- Produces:
  - `type Mode = "walk" | "shuttle" | "car"`
  - `type TripOption = { mode: Mode; minutes: number; kg_co2e: number | null; points: number }`
  - `tripOptions(route: { distance_km: number; walk_min: number; shuttle_min: number | null; car_min: number | null }, factors: { shuttle: number | null; car: number | null }, s: Settings): TripOption[]`, in walk, shuttle, car order. An option whose minutes are unknown is omitted.
  - `capSelfReported(points: number, earnedToday: number, cap: number): number`

- [ ] **Step 1: Write the failing tests**

`test/mobility.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { tripOptions } from "../src/worker/lib/mobility";
import { DEFAULT_SETTINGS } from "../src/worker/lib/settings";

const route = { distance_km: 1.9, walk_min: 25.2, shuttle_min: 9.8, car_min: 4.8 };
const f = { shuttle: 0.0965, car: 0.1705 };

describe("tripOptions", () => {
  it("returns walk, shuttle and car with time, kg and points", () => {
    expect(tripOptions(route, f, DEFAULT_SETTINGS)).toEqual([
      { mode: "walk", minutes: 25, kg_co2e: 0, points: 10 },
      { mode: "shuttle", minutes: 10, kg_co2e: 0.18, points: 5 },
      { mode: "car", minutes: 5, kg_co2e: 0.32, points: 0 },
    ]);
  });
  it("returns null kg when a factor is pending, never 0", () => {
    const opts = tripOptions(route, { shuttle: null, car: 0.1705 }, DEFAULT_SETTINGS);
    expect(opts.find((o) => o.mode === "shuttle")!.kg_co2e).toBeNull();
  });
  it("omits a mode whose time is unknown", () => {
    expect(tripOptions({ ...route, shuttle_min: null }, f, DEFAULT_SETTINGS).map((o) => o.mode)).toEqual(["walk", "car"]);
  });
  it("rounds minutes up to at least 1", () => {
    expect(tripOptions({ distance_km: 0.05, walk_min: 0.4, shuttle_min: 5.1, car_min: 0.2 }, f, DEFAULT_SETTINGS)[0].minutes).toBe(1);
  });
});
```

Append to `test/scoring.test.ts`:
```ts
import { capSelfReported } from "../src/worker/lib/scoring";

describe("capSelfReported (spec §7: 30/day)", () => {
  it("passes points through under the cap", () => expect(capSelfReported(10, 0, 30)).toBe(10));
  it("trims to what is left", () => expect(capSelfReported(10, 25, 30)).toBe(5));
  it("gives 0 at or over the cap", () => {
    expect(capSelfReported(10, 30, 30)).toBe(0);
    expect(capSelfReported(10, 45, 30)).toBe(0);
  });
  it("never goes negative for 0-point actions", () => expect(capSelfReported(0, 40, 30)).toBe(0));
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run test/mobility.test.ts test/scoring.test.ts`
Expected: FAIL ("Cannot find module", and `capSelfReported` is not a function).

- [ ] **Step 3: Implement**

`src/worker/lib/mobility.ts`:
```ts
import type { Settings } from "./settings";

export type Mode = "walk" | "shuttle" | "car";
export type TripOption = { mode: Mode; minutes: number; kg_co2e: number | null; points: number };

const mins = (m: number) => Math.max(1, Math.round(m));
const kg = (km: number, factor: number | null) => (factor == null ? null : Math.round(km * factor * 100) / 100);

export function tripOptions(
  route: { distance_km: number; walk_min: number; shuttle_min: number | null; car_min: number | null },
  factors: { shuttle: number | null; car: number | null },
  s: Settings,
): TripOption[] {
  const out: TripOption[] = [{ mode: "walk", minutes: mins(route.walk_min), kg_co2e: 0, points: s.points_walk_trip }];
  if (route.shuttle_min != null) {
    out.push({ mode: "shuttle", minutes: mins(route.shuttle_min), kg_co2e: kg(route.distance_km, factors.shuttle), points: s.points_shuttle_trip });
  }
  if (route.car_min != null) {
    out.push({ mode: "car", minutes: mins(route.car_min), kg_co2e: kg(route.distance_km, factors.car), points: 0 });
  }
  return out;
}
```

Append to `src/worker/lib/scoring.ts`:
```ts
/** Points actually awarded for a self-reported action given what was already earned today (spec §7). */
export function capSelfReported(points: number, earnedToday: number, cap: number): number {
  return Math.max(0, Math.min(points, cap - earnedToday));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/mobility.test.ts test/scoring.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/worker/lib/mobility.ts src/worker/lib/scoring.ts test/mobility.test.ts test/scoring.test.ts
git commit -m "feat(lib): trip options with sourced factors and self-reported daily cap"
```

---

### Task 4: Weekly budget

**Files:**
- Create: `src/worker/lib/budget.ts`, `test/budget.test.ts`

**Interfaces:**
- Consumes: `sgWeekStart` (Stage 1)
- Produces:
  - `type Category = "food" | "mobility" | "waste"`
  - `type Budget` (below)
  - `computeBudget(input: { createdAt: number; now: number; acts: { created_at: number; category: Category; kg_co2e: number | null }[] }): Budget`

```ts
type Line = { target: number; used: number; remaining: number; last_week: number };
type Budget =
  | { ready: false; reason: "first_week" | "no_baseline"; ready_at: number }
  | { ready: true; overall: Line; categories: Record<Category, Line>; biggest: Category | null };
```

- [ ] **Step 1: Write the failing test** `test/budget.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { computeBudget } from "../src/worker/lib/budget";

const DAY = 86_400_000;
const MON = Date.UTC(2026, 8, 27, 16, 0); // Mon 28 Sep 00:00 SGT
const created = MON - 14 * DAY; // two weeks before this week

const acts = [
  // baseline week (created .. created+7d): food 6.0, mobility 1.0
  { created_at: created + 1 * DAY, category: "food" as const, kg_co2e: 4.0 },
  { created_at: created + 2 * DAY, category: "food" as const, kg_co2e: 2.0 },
  { created_at: created + 3 * DAY, category: "mobility" as const, kg_co2e: 1.0 },
  { created_at: created + 3 * DAY, category: "waste" as const, kg_co2e: null },
  // last week: food 3.0
  { created_at: MON - 3 * DAY, category: "food" as const, kg_co2e: 3.0 },
  // this week: food 1.5, mobility 0.4
  { created_at: MON + 1 * DAY, category: "food" as const, kg_co2e: 1.5 },
  { created_at: MON + 2 * DAY, category: "mobility" as const, kg_co2e: 0.4 },
];

describe("computeBudget (spec §10)", () => {
  it("targets 85% of the first week, per category and overall", () => {
    const b = computeBudget({ createdAt: created, now: MON + 3 * DAY, acts });
    expect(b.ready).toBe(true);
    if (!b.ready) return;
    expect(b.overall).toEqual({ target: 5.95, used: 1.9, remaining: 4.05, last_week: 3 });
    expect(b.categories.food).toEqual({ target: 5.1, used: 1.5, remaining: 3.6, last_week: 3 });
    expect(b.categories.mobility).toEqual({ target: 0.85, used: 0.4, remaining: 0.45, last_week: 0 });
    expect(b.categories.waste).toEqual({ target: 0, used: 0, remaining: 0, last_week: 0 });
    expect(b.biggest).toBe("food");
  });

  it("remaining goes negative when over budget", () => {
    const over = [...acts, { created_at: MON + 2 * DAY, category: "food" as const, kg_co2e: 10 }];
    const b = computeBudget({ createdAt: created, now: MON + 3 * DAY, acts: over });
    if (!b.ready) throw new Error("expected ready");
    expect(b.categories.food.remaining).toBe(-6.4);
  });

  it("is not ready during the first week", () => {
    const b = computeBudget({ createdAt: MON, now: MON + 2 * DAY, acts: [] });
    expect(b).toEqual({ ready: false, reason: "first_week", ready_at: MON + 7 * DAY });
  });

  it("is not ready when the first week had no kg (no NaN, no division)", () => {
    const b = computeBudget({ createdAt: created, now: MON + DAY, acts: [{ created_at: created + DAY, category: "waste", kg_co2e: null }] });
    expect(b).toEqual({ ready: false, reason: "no_baseline", ready_at: created + 7 * DAY });
  });

  it("biggest is null when nothing was used this week", () => {
    const b = computeBudget({ createdAt: created, now: MON + 1000, acts: acts.filter((a) => a.created_at < MON) });
    if (!b.ready) throw new Error("expected ready");
    expect(b.biggest).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/budget.test.ts`
Expected: FAIL, "Cannot find module"

- [ ] **Step 3: Implement** `src/worker/lib/budget.ts`

```ts
import { sgWeekStart } from "./time";

const DAY = 86_400_000;
export type Category = "food" | "mobility" | "waste";
const CATS: Category[] = ["food", "mobility", "waste"];
type Line = { target: number; used: number; remaining: number; last_week: number };
export type Budget =
  | { ready: false; reason: "first_week" | "no_baseline"; ready_at: number }
  | { ready: true; overall: Line; categories: Record<Category, Line>; biggest: Category | null };

const r2 = (n: number) => Math.round(n * 100) / 100;

export function computeBudget(input: {
  createdAt: number;
  now: number;
  acts: { created_at: number; category: Category; kg_co2e: number | null }[];
}): Budget {
  const { createdAt, now, acts } = input;
  const readyAt = createdAt + 7 * DAY;
  if (now < readyAt) return { ready: false, reason: "first_week", ready_at: readyAt };

  const weekStart = sgWeekStart(now);
  const sum = (cat: Category | null, from: number, to: number) =>
    acts.reduce((n, a) => (a.kg_co2e != null && (cat === null || a.category === cat) && a.created_at >= from && a.created_at < to ? n + a.kg_co2e : n), 0);

  const baselineAll = sum(null, createdAt, readyAt);
  if (baselineAll <= 0) return { ready: false, reason: "no_baseline", ready_at: readyAt };

  const line = (cat: Category | null): Line => {
    const target = r2(sum(cat, createdAt, readyAt) * 0.85);
    const used = r2(sum(cat, weekStart, now + 1));
    return { target, used, remaining: r2(target - used), last_week: r2(sum(cat, weekStart - 7 * DAY, weekStart)) };
  };
  const categories = Object.fromEntries(CATS.map((c) => [c, line(c)])) as Record<Category, Line>;
  const biggest = CATS.reduce<Category | null>((best, c) => (categories[c].used > 0 && (best === null || categories[c].used > categories[best].used) ? c : best), null);
  return { ready: true, overall: line(null), categories, biggest };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run test/budget.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/worker/lib/budget.ts test/budget.test.ts
git commit -m "feat(lib): weekly carbon budget from the student's own first week"
```

---

### Task 5: Logging API (locations, trip options, trips, steps, returns)

**Files:**
- Create: `src/worker/routes/log.ts`, `test/log.test.ts`
- Modify: `src/worker/app.ts`

**Interfaces:**
- Consumes:
  - `tripOptions`, `Mode` (Task 3)
  - `capSelfReported` (Task 3)
  - `insertActivity` (Stage 1)
  - `loadSettings`, `requireRole`, `fail`, `sgDayStart` (Stage 1)
- Produces (all student-only):
  - `GET /api/locations` → `{ locations: { id, name }[] }` (sorted by name)
  - `GET /api/trips/options?from=&to=` → `{ from: {id,name}, to: {id,name}, distance_km, options: TripOption[] }`
  - `POST /api/trips { from_id, to_id, mode }` → 201 `{ points, capped: boolean, kg_co2e }`
  - `POST /api/steps { steps }` → 201 `{ points: 0, steps }`
  - `POST /api/returns { count }` → 201 `{ points, capped }`
  - errors:
    - `400 same_place`
    - `400 unknown_place`
    - `404 no_route`
    - `400 invalid_mode`
    - `400 invalid_steps`
    - `400 invalid_count`

- [ ] **Step 1: Write the failing test** `test/log.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { setup } from "./helpers/setup";

async function newStudent(ctx: Awaited<ReturnType<typeof setup>>) {
  const res = await ctx.req("/api/session", { body: { display_name: "Tester" } });
  return res.body.user.id as string;
}

describe("GET /api/locations", () => {
  it("lists campus locations by name, students only", async () => {
    const ctx = await setup();
    const res = await ctx.req("/api/locations", { as: "u-alex" });
    expect(res.body.locations[0]).toEqual({ id: "canteen-2", name: "Canteen 2" });
    expect(res.body.locations).toHaveLength(7);
    expect((await ctx.req("/api/locations", { as: "u-seller-econ" })).status).toBe(403);
  });
});

describe("GET /api/trips/options", () => {
  it("returns walk/shuttle/car for a pair in either direction", async () => {
    const ctx = await setup();
    const a = await ctx.req("/api/trips/options?from=hive&to=north-spine", { as: "u-alex" });
    const b = await ctx.req("/api/trips/options?from=north-spine&to=hive", { as: "u-alex" });
    expect(a.status).toBe(200);
    expect(a.body.options.map((o: any) => o.mode)).toEqual(["walk", "shuttle", "car"]);
    expect(b.body.distance_km).toBe(a.body.distance_km);
    expect(a.body.from).toEqual({ id: "hive", name: "The Hive" });
  });

  it.each([
    ["hive", "hive", 400, "same_place"],
    ["hive", "nowhere", 400, "unknown_place"],
    ["", "hive", 400, "unknown_place"],
  ])("from=%s to=%s → %i %s", async (from, to, status, error) => {
    const ctx = await setup();
    const res = await ctx.req(`/api/trips/options?from=${from}&to=${to}`, { as: "u-alex" });
    expect(res.status).toBe(status);
    expect(res.body.error).toBe(error);
  });

  it("404s when two known places have no route", async () => {
    const ctx = await setup();
    ctx.raw.exec("DELETE FROM routes WHERE (from_id='hive' AND to_id='north-spine') OR (from_id='north-spine' AND to_id='hive')");
    expect((await ctx.req("/api/trips/options?from=hive&to=north-spine", { as: "u-alex" })).body.error).toBe("no_route");
  });

  it("shows null kg for a pending factor", async () => {
    const ctx = await setup();
    ctx.raw.exec("UPDATE factors SET kg_per_unit=NULL WHERE key='shuttle'");
    const res = await ctx.req("/api/trips/options?from=hive&to=north-spine", { as: "u-alex" });
    expect(res.body.options.find((o: any) => o.mode === "shuttle").kg_co2e).toBeNull();
  });
});

describe("POST /api/trips", () => {
  it("logs a self-reported walk with 0 kg and +10", async () => {
    const ctx = await setup();
    const uid = await newStudent(ctx);
    const res = await ctx.req("/api/trips", { as: uid, body: { from_id: "hive", to_id: "north-spine", mode: "walk" } });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ points: 10, capped: false, kg_co2e: 0 });
    const row = ctx.raw.prepare("SELECT category, type, verified, source, kg_co2e, points, detail_json FROM activities WHERE user_id=?").get(uid) as any;
    expect(row).toMatchObject({ category: "mobility", type: "trip", verified: 0, source: "manual", kg_co2e: 0, points: 10 });
    expect(JSON.parse(row.detail_json)).toMatchObject({ from_id: "hive", to_id: "north-spine", mode: "walk" });
  });

  it("logs a car trip with kg and 0 points", async () => {
    const ctx = await setup();
    const uid = await newStudent(ctx);
    const res = await ctx.req("/api/trips", { as: uid, body: { from_id: "hall-11", to_id: "north-spine", mode: "car" } });
    expect(res.body.points).toBe(0);
    expect(res.body.kg_co2e).toBeGreaterThan(0);
  });

  it("stores NULL kg when the factor is pending", async () => {
    const ctx = await setup();
    const uid = await newStudent(ctx);
    ctx.raw.exec("UPDATE factors SET kg_per_unit=NULL WHERE key='car'");
    const res = await ctx.req("/api/trips", { as: uid, body: { from_id: "hive", to_id: "north-spine", mode: "car" } });
    expect(res.body.kg_co2e).toBeNull();
    expect((ctx.raw.prepare("SELECT kg_co2e FROM activities WHERE user_id=?").get(uid) as any).kg_co2e).toBeNull();
  });

  it("caps self-reported points at 30 per day but still logs the trip", async () => {
    const ctx = await setup();
    const uid = await newStudent(ctx);
    const walk = () => ctx.req("/api/trips", { as: uid, body: { from_id: "hive", to_id: "north-spine", mode: "walk" } });
    expect((await walk()).body.points).toBe(10);
    expect((await walk()).body.points).toBe(10);
    expect((await walk()).body.points).toBe(10);
    const fourth = await walk();
    expect(fourth.status).toBe(201);
    expect(fourth.body).toMatchObject({ points: 0, capped: true });
    expect((ctx.raw.prepare("SELECT COUNT(*) AS n FROM activities WHERE user_id=?").get(uid) as any).n).toBe(4);
  });

  it("verified stall points do not count toward the self-reported cap", async () => {
    const ctx = await setup();
    const uid = await newStudent(ctx);
    ctx.raw.exec(`INSERT INTO activities (id,user_id,category,type,points,verified,source,created_at) VALUES ('v','${uid}','food','meal',35,1,'qr',${Date.now()})`);
    expect((await ctx.req("/api/trips", { as: uid, body: { from_id: "hive", to_id: "north-spine", mode: "walk" } })).body.points).toBe(10);
  });

  it.each([
    [{ from_id: "hive", to_id: "hive", mode: "walk" }, "same_place"],
    [{ from_id: "hive", to_id: "mars", mode: "walk" }, "unknown_place"],
    [{ from_id: "hive", to_id: "north-spine", mode: "teleport" }, "invalid_mode"],
    [{ from_id: "hive", to_id: "north-spine" }, "invalid_mode"],
    [{}, "unknown_place"],
  ])("rejects %j with 400 %s", async (body, error) => {
    const ctx = await setup();
    const res = await ctx.req("/api/trips", { as: "u-alex", body });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(error);
  });
});

describe("POST /api/steps", () => {
  it("logs steps with 0 points and no kg", async () => {
    const ctx = await setup();
    const uid = await newStudent(ctx);
    const res = await ctx.req("/api/steps", { as: uid, body: { steps: 5200 } });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ points: 0, steps: 5200 });
    const row = ctx.raw.prepare("SELECT category, type, kg_co2e, verified, detail_json FROM activities WHERE user_id=?").get(uid) as any;
    expect(row).toMatchObject({ category: "mobility", type: "steps", kg_co2e: null, verified: 0 });
    expect(JSON.parse(row.detail_json)).toEqual({ steps: 5200 });
  });

  it.each([[0], [-5], [12.5], ["5000"], [100001], [null], [undefined]])("rejects steps=%j", async (steps) => {
    const ctx = await setup();
    const res = await ctx.req("/api/steps", { as: "u-alex", body: { steps } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_steps");
  });
});

describe("POST /api/returns", () => {
  it("awards +5 per container, capped, with NULL kg", async () => {
    const ctx = await setup();
    const uid = await newStudent(ctx);
    expect((await ctx.req("/api/returns", { as: uid, body: { count: 3 } })).body).toEqual({ points: 15, capped: false });
    expect((await ctx.req("/api/returns", { as: uid, body: { count: 4 } })).body).toEqual({ points: 15, capped: true });
    const rows = ctx.raw.prepare("SELECT category, type, kg_co2e, detail_json FROM activities WHERE user_id=? ORDER BY created_at").all(uid) as any[];
    expect(rows[0]).toMatchObject({ category: "waste", type: "container_return", kg_co2e: null });
    expect(JSON.parse(rows[1].detail_json)).toEqual({ count: 4 });
  });

  it.each([[0], [21], [1.5], ["2"], [null]])("rejects count=%j", async (count) => {
    const ctx = await setup();
    const res = await ctx.req("/api/returns", { as: "u-alex", body: { count } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_count");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/log.test.ts`
Expected: FAIL (404s)

- [ ] **Step 3: Implement** `src/worker/routes/log.ts`

```ts
import { Hono } from "hono";
import { insertActivity } from "../activities";
import { loadSettings } from "../db";
import type { AppEnv } from "../env";
import { fail } from "../http";
import { tripOptions, type Mode } from "../lib/mobility";
import { capSelfReported } from "../lib/scoring";
import { sgDayStart } from "../lib/time";
import { requireRole } from "../session";

export const log = new Hono<AppEnv>();
const student = requireRole("student");
const MODES: Mode[] = ["walk", "shuttle", "car"];

type Place = { id: string; name: string };
type RouteRow = { distance_km: number; walk_min: number; shuttle_min: number | null; car_min: number | null };

async function place(db: D1Database, id: unknown): Promise<Place | null> {
  if (typeof id !== "string" || id === "") return null;
  return db.prepare("SELECT id, name FROM locations WHERE id = ?").bind(id).first<Place>();
}

async function resolveTrip(db: D1Database, fromId: unknown, toId: unknown) {
  const [from, to] = await Promise.all([place(db, fromId), place(db, toId)]);
  if (!from || !to) return { error: [400, "unknown_place", "Pick places from the list."] as const };
  if (from.id === to.id) return { error: [400, "same_place", "Pick two different places."] as const };
  const route = await db
    .prepare("SELECT distance_km, walk_min, shuttle_min, car_min FROM routes WHERE (from_id = ?1 AND to_id = ?2) OR (from_id = ?2 AND to_id = ?1)")
    .bind(from.id, to.id)
    .first<RouteRow>();
  if (!route) return { error: [404, "no_route", "We don't have that route yet."] as const };
  const f = await db.prepare("SELECT key, kg_per_unit FROM factors WHERE key IN ('shuttle','car')").all<{ key: string; kg_per_unit: number | null }>();
  const factors = { shuttle: null as number | null, car: null as number | null };
  for (const r of f.results) factors[r.key as "shuttle" | "car"] = r.kg_per_unit;
  return { from, to, route, factors };
}

async function selfReportedToday(db: D1Database, uid: string, now: number): Promise<number> {
  return (
    (await db
      .prepare("SELECT COALESCE(SUM(points),0) AS n FROM activities WHERE user_id = ? AND verified = 0 AND created_at >= ?")
      .bind(uid, sgDayStart(now))
      .first<number>("n")) ?? 0
  );
}

const isInt = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

log.get("/locations", student, async (c) => {
  const { results } = await c.env.DB.prepare("SELECT id, name FROM locations ORDER BY name").all<Place>();
  return c.json({ locations: results });
});

log.get("/trips/options", student, async (c) => {
  const t = await resolveTrip(c.env.DB, c.req.query("from"), c.req.query("to"));
  if ("error" in t) return fail(c, t.error[0], t.error[1], t.error[2]);
  const s = await loadSettings(c.env.DB);
  return c.json({ from: t.from, to: t.to, distance_km: t.route.distance_km, options: tripOptions(t.route, t.factors, s) });
});

log.post("/trips", student, async (c) => {
  const db = c.env.DB;
  const body = (await c.req.json().catch(() => ({}))) as { from_id?: unknown; to_id?: unknown; mode?: unknown };
  const t = await resolveTrip(db, body.from_id, body.to_id);
  if ("error" in t) return fail(c, t.error[0], t.error[1], t.error[2]);
  if (!MODES.includes(body.mode as Mode)) return fail(c, 400, "invalid_mode", "Pick walk, shuttle or car.");
  const s = await loadSettings(db);
  const option = tripOptions(t.route, t.factors, s).find((o) => o.mode === body.mode);
  if (!option) return fail(c, 400, "invalid_mode", "That option isn't available for this route.");
  const uid = c.get("user")!.id;
  const now = Date.now();
  const points = capSelfReported(option.points, await selfReportedToday(db, uid, now), s.self_reported_daily_cap);
  await insertActivity(db, {
    user_id: uid, category: "mobility", type: "trip", kg_co2e: option.kg_co2e, points, verified: false, source: "manual",
    detail: { from_id: t.from.id, to_id: t.to.id, mode: option.mode, distance_km: t.route.distance_km }, created_at: now,
  }).run();
  return c.json({ points, capped: points < option.points, kg_co2e: option.kg_co2e }, 201);
});

log.post("/steps", student, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { steps?: unknown };
  if (!isInt(body.steps, 1, 100_000)) return fail(c, 400, "invalid_steps", "Enter a whole number of steps up to 100,000.");
  await insertActivity(c.env.DB, {
    user_id: c.get("user")!.id, category: "mobility", type: "steps", kg_co2e: null, points: 0, verified: false, source: "manual",
    detail: { steps: body.steps }, created_at: Date.now(),
  }).run();
  return c.json({ points: 0, steps: body.steps }, 201);
});

log.post("/returns", student, async (c) => {
  const db = c.env.DB;
  const body = (await c.req.json().catch(() => ({}))) as { count?: unknown };
  if (!isInt(body.count, 1, 20)) return fail(c, 400, "invalid_count", "Enter between 1 and 20 containers.");
  const s = await loadSettings(db);
  const uid = c.get("user")!.id;
  const now = Date.now();
  const full = body.count * s.points_container_return;
  const points = capSelfReported(full, await selfReportedToday(db, uid, now), s.self_reported_daily_cap);
  await insertActivity(db, {
    user_id: uid, category: "waste", type: "container_return", kg_co2e: null, points, verified: false, source: "manual",
    detail: { count: body.count }, created_at: now,
  }).run();
  return c.json({ points, capped: points < full }, 201);
});
```

Modify `src/worker/app.ts`: add `import { log } from "./routes/log";` and `app.route("/", log);`.

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/worker/routes/log.ts src/worker/app.ts test/log.test.ts
git commit -m "feat(log): trips, steps and container returns as capped self-reported activities"
```

---

### Task 6: Budget and activity details in the summary

**Files:**
- Modify: `src/worker/routes/me.ts`, `test/me.test.ts`

**Interfaces:**
- Consumes: `computeBudget`, `Budget` (Task 4)
- Produces: `/api/me/summary` gains:
  - `budget: Budget`
  - `recent[].detail: Record<string, unknown>`, parsed from `detail_json`
  - `recent[].place_names: { from: string; to: string } | null`, for trips

- [ ] **Step 1: Write the failing tests** (add inside `describe("GET /api/me/summary")` in `test/me.test.ts`)

```ts
  it("returns a ready budget for a seeded persona", async () => {
    const { req } = await setup();
    const b = (await req("/api/me/summary", { as: "u-alex" })).body.budget;
    expect(b.ready).toBe(true);
    expect(b.overall.target).toBeGreaterThan(0);
    expect(Object.keys(b.categories)).toEqual(["food", "mobility", "waste"]);
  });

  it("returns a not-ready budget for a brand-new student", async () => {
    const { req } = await setup();
    const s = await req("/api/session", { body: { display_name: "New" } });
    const b = (await req("/api/me/summary", { as: s.body.user.id })).body.budget;
    expect(b).toMatchObject({ ready: false, reason: "first_week" });
  });

  it("includes trip details with place names in recent", async () => {
    const { req } = await setup();
    const s = await req("/api/session", { body: { display_name: "Walker" } });
    await req("/api/trips", { as: s.body.user.id, body: { from_id: "hive", to_id: "north-spine", mode: "walk" } });
    const r = (await req("/api/me/summary", { as: s.body.user.id })).body.recent[0];
    expect(r.type).toBe("trip");
    expect(r.detail).toMatchObject({ mode: "walk" });
    expect(r.place_names).toEqual({ from: "The Hive", to: "North Spine" });
  });
```

The existing "returns zeros for a new student" test uses `u-bea`, who now has seeded history. Change it to a fresh `POST /api/session` student and keep its assertions. The Stage 1 "sums total and this-week points" and "counts this week's meals" tests use `u-alex`: switch them to fresh students too, because Alex now has history.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run test/me.test.ts`
Expected: the new tests FAIL (`budget` and `detail` are undefined).

- [ ] **Step 3: Implement.** In `src/worker/routes/me.ts`:
  1. Add `detail_json` and a trip-place lookup to the recent query.
  2. Load `created_at` and the category/kg history.
  3. Call `computeBudget`.

Replace the recent query with:
```ts
  const { results } = await db
    .prepare(
      `SELECT a.type, a.points, a.kg_co2e, a.low_carbon, a.verified, a.created_at, a.detail_json, i.name AS item_name,
              lf.name AS from_name, lt.name AS to_name
       FROM activities a
       LEFT JOIN items i ON i.id = a.item_id
       LEFT JOIN locations lf ON a.type = 'trip' AND lf.id = json_extract(a.detail_json, '$.from_id')
       LEFT JOIN locations lt ON a.type = 'trip' AND lt.id = json_extract(a.detail_json, '$.to_id')
       WHERE a.user_id = ? ORDER BY a.created_at DESC LIMIT 20`,
    )
    .bind(uid)
    .all<{ type: string; points: number; kg_co2e: number | null; low_carbon: number | null; verified: number; created_at: number; detail_json: string; item_name: string | null; from_name: string | null; to_name: string | null }>();
```

Add to the `Promise.all` list:
```ts
    db.prepare("SELECT created_at FROM users WHERE id = ?").bind(uid).first<number>("created_at"),
    db.prepare("SELECT created_at, category, kg_co2e FROM activities WHERE user_id = ?").bind(uid)
      .all<{ created_at: number; category: "food" | "mobility" | "waste"; kg_co2e: number | null }>(),
```
and destructure them as `createdAt, allActs`. Add `import { computeBudget } from "../lib/budget";`.

In the JSON response, add `budget: computeBudget({ createdAt: createdAt ?? Date.now(), now: Date.now(), acts: allActs.results }),` and change the `recent` mapping to:
```ts
    recent: results.map(({ detail_json, from_name, to_name, ...r }) => ({
      ...r,
      low_carbon: r.low_carbon == null ? null : r.low_carbon === 1,
      verified: r.verified === 1,
      detail: JSON.parse(detail_json || "{}"),
      place_names: from_name && to_name ? { from: from_name, to: to_name } : null,
    })),
```

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/worker/routes/me.ts test/me.test.ts
git commit -m "feat(me): weekly budget and trip details in the summary"
```

---

### Task 7: Copy helpers for activity labels and the budget line

**Files:**
- Modify: `src/app/copy.ts`, `test/copy.test.ts`

**Interfaces:**
- Produces:
  - `activityLabel(a: { type: string; item_name: string | null; detail: Record<string, unknown>; place_names: { from: string; to: string } | null }): string`
  - `budgetLine(b: { categories: Record<"food" | "mobility" | "waste", { target: number; used: number }> }): string`

- [ ] **Step 1: Write the failing tests** (append to `test/copy.test.ts`)

```ts
import { activityLabel, budgetLine } from "../src/app/copy";

describe("activityLabel", () => {
  const base = { item_name: null, detail: {}, place_names: null };
  it("names meals by short dish name", () => {
    expect(activityLabel({ ...base, type: "meal", item_name: "Economy rice: 2 veg + egg" })).toBe("2 veg + egg economy rice");
  });
  it("describes trips with mode and places", () => {
    expect(activityLabel({ ...base, type: "trip", detail: { mode: "walk" }, place_names: { from: "The Hive", to: "Hall 11" } })).toBe("Walked, The Hive to Hall 11");
    expect(activityLabel({ ...base, type: "trip", detail: { mode: "shuttle" }, place_names: { from: "A", to: "B" } })).toBe("Shuttle, A to B");
    expect(activityLabel({ ...base, type: "trip", detail: { mode: "car" }, place_names: { from: "A", to: "B" } })).toBe("Car or Grab, A to B");
  });
  it("describes steps and returns", () => {
    expect(activityLabel({ ...base, type: "steps", detail: { steps: 5200 } })).toBe("5,200 steps");
    expect(activityLabel({ ...base, type: "container_return", detail: { count: 1 } })).toBe("Returned 1 container");
    expect(activityLabel({ ...base, type: "container_return", detail: { count: 3 } })).toBe("Returned 3 containers");
    expect(activityLabel({ ...base, type: "byo" })).toBe("Own cup or container");
  });
});

describe("budgetLine", () => {
  it("lists categories that have a target or usage, food first", () => {
    expect(budgetLine({ categories: { food: { target: 5.1, used: 1.5 }, mobility: { target: 0.85, used: 0.4 }, waste: { target: 0, used: 0 } } }))
      .toBe("Food 1.5 of 5.1 kg · Mobility 0.4 of 0.85 kg");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run test/copy.test.ts`
Expected: FAIL (not a function)

- [ ] **Step 3: Implement** (append to `src/app/copy.ts`)

```ts
const MODE_LABEL: Record<string, string> = { walk: "Walked", shuttle: "Shuttle", car: "Car or Grab" };

export function activityLabel(a: {
  type: string;
  item_name: string | null;
  detail: Record<string, unknown>;
  place_names: { from: string; to: string } | null;
}): string {
  if (a.item_name) return shortName(a.item_name);
  if (a.type === "trip") {
    const mode = MODE_LABEL[String(a.detail.mode)] ?? "Trip";
    return a.place_names ? `${mode}, ${a.place_names.from} to ${a.place_names.to}` : mode;
  }
  if (a.type === "steps") return `${Number(a.detail.steps).toLocaleString("en-SG")} steps`;
  if (a.type === "container_return") {
    const n = Number(a.detail.count);
    return `Returned ${n} container${n === 1 ? "" : "s"}`;
  }
  if (a.type === "byo") return "Own cup or container";
  return a.type === "drink" ? "Drink" : "Meal";
}

const CAT_LABEL = { food: "Food", mobility: "Mobility", waste: "Waste" } as const;

export function budgetLine(b: { categories: Record<"food" | "mobility" | "waste", { target: number; used: number }> }): string {
  return (Object.keys(CAT_LABEL) as (keyof typeof CAT_LABEL)[])
    .filter((k) => b.categories[k].target > 0 || b.categories[k].used > 0)
    .map((k) => `${CAT_LABEL[k]} ${b.categories[k].used} of ${b.categories[k].target} kg`)
    .join(" · ");
}
```

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/copy.ts test/copy.test.ts
git commit -m "feat(app): copy for activity labels and budget line"
```

---

### Task 8: Tab bar, Log screen and budget on Home

**Files:**
- Create: `src/app/components/TabBar.tsx`, `src/app/screens/Log.tsx`
- Modify: `src/app/App.tsx`, `src/app/screens/Home.tsx`, `src/app/styles.css`

**Interfaces:**
- Consumes:
  - the Task 5 endpoints
  - `/api/me/summary` with `budget`, `detail` and `place_names` (Task 6)
  - `activityLabel`, `budgetLine` (Task 7)

There are no unit tests for the UI. It is checked by the build and in the browser (Step 6).

- [ ] **Step 1: Add styles** (append to `src/app/styles.css`)

```css
/* Tab bar: floating glass chrome */
.page.has-tabs { padding-bottom: calc(110px + env(safe-area-inset-bottom)); }
.tabbar {
  position: fixed; left: 50%; transform: translateX(-50%);
  bottom: calc(16px + env(safe-area-inset-bottom));
  display: flex; gap: 4px; padding: 6px; border-radius: 999px; z-index: 10;
}
.tabbar button {
  appearance: none; border: 0; background: none; cursor: pointer;
  padding: 10px 22px; border-radius: 999px; font-size: 14px; color: var(--text-2);
}
.tabbar button[aria-current="page"] { background: var(--ink); color: #fff; }

/* Log */
select {
  width: 100%; padding: 14px 16px; border-radius: 14px; border: 0.5px solid var(--line);
  font: inherit; font-size: 16px; background: var(--card); color: var(--text); appearance: none;
}
.field-label { font-size: 13px; color: var(--muted); margin: 0 0 6px; }
.options { display: flex; flex-direction: column; gap: 8px; }
.option {
  appearance: none; border: 0.5px solid transparent; cursor: pointer; text-align: left;
  background: var(--card); border-radius: 16px; padding: 14px 16px;
  display: flex; justify-content: space-between; align-items: center; gap: 12px;
}
.option:active { transform: scale(0.99); }
.option .mode { font-size: 16px; }
.option .sub { font-size: 13px; color: var(--muted); margin-top: 2px; }
.option .pts { font-family: var(--serif); font-size: 18px; }
.stepper { display: flex; align-items: center; gap: 16px; }
.stepper button { appearance: none; width: 40px; height: 40px; border-radius: 50%; border: 0.5px solid var(--line); background: var(--card); font-size: 20px; cursor: pointer; }
.toast { background: var(--accent-soft); color: var(--accent); border-radius: 14px; padding: 12px 14px; font-size: 14px; }
.section { display: flex; flex-direction: column; gap: 12px; padding-top: 8px; }
```

- [ ] **Step 2: Write `src/app/components/TabBar.tsx`**

```tsx
import { navigate } from "../router";

const TABS = [
  { path: "/", label: "Today" },
  { path: "/log", label: "Log" },
];

export function TabBar({ path }: { path: string }) {
  return (
    <nav className="tabbar glass" aria-label="Main">
      {TABS.map((t) => (
        <button key={t.path} aria-current={path === t.path ? "page" : undefined} onClick={() => navigate(t.path)}>
          {t.label}
        </button>
      ))}
    </nav>
  );
}
```

- [ ] **Step 3: Write `src/app/screens/Log.tsx`**

```tsx
import { useEffect, useState } from "react";
import { api, ApiError } from "../api";

type Place = { id: string; name: string };
type Option = { mode: "walk" | "shuttle" | "car"; minutes: number; kg_co2e: number | null; points: number };
type Options = { from: Place; to: Place; distance_km: number; options: Option[] };

const MODE = { walk: "Walk", shuttle: "Campus shuttle", car: "Car or Grab" } as const;

export function Log() {
  const [places, setPlaces] = useState<Place[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [opts, setOpts] = useState<Options | null>(null);
  const [steps, setSteps] = useState("");
  const [count, setCount] = useState(1);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ locations: Place[] }>("/locations").then((d) => setPlaces(d.locations)).catch(() => setError("Couldn't load places."));
  }, []);

  useEffect(() => {
    setOpts(null);
    if (!from || !to || from === to) return;
    api<Options>(`/trips/options?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .then(setOpts)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load options."));
  }, [from, to]);

  async function run(fn: () => Promise<string>) {
    setError(null);
    setToast(null);
    try {
      setToast(await fn());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
    }
  }

  const pts = (p: number, capped: boolean) => (capped ? `+${p} (daily limit reached)` : `+${p}`);

  return (
    <>
      <div>
        <div className="eyebrow">Self-reported</div>
        <h1 className="display" style={{ marginTop: 8 }}>Log a trip, your steps or a return.</h1>
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
      {error && <p className="error">{error}</p>}

      <div className="section">
        <h2 className="title">Trip</h2>
        <div>
          <p className="field-label">From</p>
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">Choose a place</option>
            {places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <p className="field-label">To</p>
          <select value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Choose a place</option>
            {places.filter((p) => p.id !== from).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        {opts && (
          <div className="options">
            <p className="muted">{opts.distance_km} km on foot · tap how you went</p>
            {opts.options.map((o) => (
              <button
                key={o.mode}
                className="option"
                onClick={() =>
                  run(async () => {
                    const r = await api<{ points: number; capped: boolean }>("/trips", { from_id: from, to_id: to, mode: o.mode });
                    setFrom("");
                    setTo("");
                    return `${MODE[o.mode]} logged ${pts(r.points, r.capped)}`;
                  })
                }
              >
                <div>
                  <div className="mode">{MODE[o.mode]}</div>
                  <div className="sub">{o.minutes} min · {o.kg_co2e == null ? "factor pending" : `${o.kg_co2e} kg CO₂e`}</div>
                </div>
                <span className={o.points > 0 ? "pts green" : "pts"}>{o.points > 0 ? `+${o.points}` : "0"}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <hr className="rule" />
      <div className="section">
        <h2 className="title">Steps today</h2>
        <input type="text" inputMode="numeric" placeholder="5000" value={steps} onChange={(e) => setSteps(e.target.value.replace(/\D/g, ""))} />
        <button
          className="btn btn-secondary"
          disabled={steps === ""}
          onClick={() =>
            run(async () => {
              await api("/steps", { steps: Number(steps) });
              setSteps("");
              return `${Number(steps).toLocaleString("en-SG")} steps logged`;
            })
          }
        >
          Log steps
        </button>
      </div>

      <hr className="rule" />
      <div className="section">
        <h2 className="title">Container returns</h2>
        <p className="body" style={{ fontSize: 14 }}>Bottles and cans returned under the Beverage Container Return Scheme.</p>
        <div className="stepper">
          <button aria-label="Fewer" onClick={() => setCount((n) => Math.max(1, n - 1))}>−</button>
          <span className="num">{count}</span>
          <button aria-label="More" onClick={() => setCount((n) => Math.min(20, n + 1))}>+</button>
        </div>
        <button
          className="btn btn-secondary"
          onClick={() =>
            run(async () => {
              const r = await api<{ points: number; capped: boolean }>("/returns", { count });
              setCount(1);
              return `${count} returned ${pts(r.points, r.capped)}`;
            })
          }
        >
          Log returns
        </button>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Update `src/app/screens/Home.tsx`**
  1. Extend the `Summary` type with:
     - `budget: { ready: false; reason: "first_week" | "no_baseline"; ready_at: number } | { ready: true; overall: { target: number; used: number; remaining: number; last_week: number }; categories: Record<"food" | "mobility" | "waste", { target: number; used: number; remaining: number; last_week: number }>; biggest: "food" | "mobility" | "waste" | null }`
     - `detail: Record<string, unknown>` and `place_names: { from: string; to: string } | null` on recent items
  2. Replace the grey panel's second figure. When `data.budget.ready`, show `data.budget.overall.remaining` labelled "kg left of budget", with the class `num` (plus `style={{ color: "var(--danger)" }}` when it's negative). Otherwise keep "kg CO₂e logged".
  3. Under the panel, when `data.budget.ready`, add `<p className="muted">{budgetLine(data.budget)}</p>`. When it isn't ready and `reason === "first_week"`, add `<p className="muted">Your budget starts {new Date(data.budget.ready_at).toLocaleDateString("en-SG", { weekday: "long", timeZone: "Asia/Singapore" })}, based on your first week.</p>`.
  4. In the recent list, replace the `a.item_name ? shortName(a.item_name) : LABEL[a.type] ?? a.type` expression with `activityLabel(a)`, and delete the now-unused `LABEL` constant.
  5. Update the imports: `import { activityLabel, budgetLine, factHeadline, shortName, weekHeadline } from "../copy";`

- [ ] **Step 5: Route it in `src/app/App.tsx`**

Add the imports `Log` and `TabBar`. Give the page the tab padding for students, add the `/log` route, and render the tab bar:
```tsx
  const student = role === "student";
  const main = path !== "/claim" && path !== "/admin";
  return (
    <div className={student && main ? "page has-tabs" : "page"}>
      {me.can_switch && path !== "/admin" && (
        <div className="topbar">
          <span>Viewing as {me.user.display_name} · {role}</span>
          <button className="link-btn" onClick={() => navigate("/admin")}>Switch</button>
        </div>
      )}
      {path === "/claim" && <Claim />}
      {path === "/admin" && me.can_switch && <Admin />}
      {main && role === "seller" && <Stall />}
      {main && student && path === "/log" && <Log />}
      {main && student && path !== "/log" && <Home user={me.user} />}
      {main && role === "admin" && <Admin />}
      {student && main && <TabBar path={path} />}
    </div>
  );
```

- [ ] **Step 6: Build and check in the browser**

Run: `npm run build && npm run typecheck`
Expected: no errors.

Then run `npm run db:local` (it applies migration 0002 and the conflict-safe seed) and start the preview (config `dev`). At 375 px:
1. Switch to Alex. Home shows a budget figure ("kg left of budget"), a Food/Mobility line, and recent items including "Car or Grab, Hall 11 to The Hive" if it's in the last three.
2. The tab bar floats at the bottom as glass pills, and "Today" is highlighted.
3. Tap Log, choose The Hive → North Spine. Three options appear with minutes, kg and points. Tap Walk: the toast reads "Walk logged +10".
4. Log a 4th walk in the same day. The toast shows the daily limit reached.
5. Log 5,200 steps, then 2 returns. The toasts confirm.
6. Go back to Today: the new items appear in Recent.
7. Sign up a fresh student: Home shows the first-visit screen, and after logging one walk it says "Your budget starts <weekday>…".
8. No horizontal scroll, and the tab bar doesn't cover the last row of content.

- [ ] **Step 7: Commit**

```bash
git add src/app
git commit -m "feat(app): glass tab bar, Log screen for trips/steps/returns, budget on Today"
```

---

### Task 9: Update the spec, migrate and seed live, deploy

This changes the live database and redeploys the approved app. The migration only adds columns. The seed is now conflict-safe (Task 1), so it doesn't overwrite live accounts or activity.

**Files:**
- Modify: `docs/superpowers/specs/2026-09-29-campus-carbon-app-design.md` (§14.1 mobility factors, §14.4 routes)

- [ ] **Step 1: Update spec §14.1.** Replace the paragraph "Mobility factors (kg per passenger-km): `shuttle` and `car` are seeded **null (pending)**…" with:

```markdown
Mobility factors (kg CO2e per passenger-km), from UK DESNZ (2022) conversion factors via Our World in Data, "Carbon footprint of travel per kilometer" (ourworldindata.org/grapher/carbon-footprint-travel-mode):
- `car` = 0.1705 ("Petrol car", single occupant). Also used for Grab, because the dataset has no taxi row.
- `shuttle` = 0.0965 ("Bus (average)"). This is a cautious proxy. NTU launched electric campus shuttles with ComfortDelGro and says the fleet "will eventually be fully electrified" (ntu.edu.sg), so the fleet is not fully electric yet. The real per-passenger figure is lower and falling. Revisit it once NTU publishes fleet or energy data.
```

In §14.4, replace the Routes bullet with:
```markdown
- Routes: walking distance and time, and driving time, for every pair of the 7 demo locations. Generated by `npm run seed:routes` from OpenStreetMap via OSRM (routing.openstreetmap.de), using location coordinates from OpenStreetMap Nominatim. Shuttle time = driving time + 5 min average wait (an assumption).
```

- [ ] **Step 2: Apply to the live database**

```bash
npx wrangler d1 migrations apply campus-carbon --remote
npm run seed:sql
npx wrangler d1 execute campus-carbon --remote --file seed/seed.sql
```
Expected: migration `0002_mobility.sql` ✅ and the seed executes. Then verify that nothing live was clobbered:
```bash
npx wrangler d1 execute campus-carbon --remote --command "SELECT display_name, role FROM users WHERE display_name='Simon'"
```
Expected: the Simon rows are still `admin`.

- [ ] **Step 3: Deploy**

Run: `npm run deploy`, then `curl -s https://campus-carbon.stan322.workers.dev/api/health`
Expected: `{"ok":true}`

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-09-29-campus-carbon-app-design.md
git commit -m "docs(spec): sourced mobility factors and OSRM routes"
```
