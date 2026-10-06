# Weekly Recap Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Students share a 1080×1920 image of last week or this week so far. It is drawn on the phone and shared through the phone's share sheet, with Download as the fallback.

**Architecture:**
- A pure builder, `src/worker/lib/recap.ts`, turns the student's activity and the week's standings into the recap payload. It reuses the leaderboard, insights, budget and streak functions.
- A thin route serves `GET /api/me/recap`.
- On the phone, `recapLines()` (pure, tested) decides the text, and `drawRecap()` paints it with Canvas 2D.

**Tech Stack:**
- Cloudflare Worker + Hono, D1
- React 19 + Vite
- Vitest on the `node:sqlite` D1 adapter
- Canvas 2D, the Web Share API, and `qrcode` (already a dependency)

**Spec:** `docs/superpowers/specs/2026-10-07-weekly-recap-card-design.md`. It extends `docs/superpowers/specs/2026-09-29-campus-carbon-app-design.md` and reuses `docs/superpowers/specs/2026-10-06-insights-and-impact-design.md`.

## Global Constraints

- **Weeks:**
  - **Last week** is `[sgWeekStart(now) − 7 days, sgWeekStart(now))`, and its `week_end` is `sgWeekStart(now)`.
  - **This week** is `[sgWeekStart(now), now]`, and its `week_end` is `now`.
  - A missing or unknown `week` query value means `last`.
- **`points`** must equal the leaderboard's points for the same range. It uses `periodPoints(acts, from, to, missionPoints)`.
- **Meals:** verified meals are `type='meal' AND verified=1`. `kg_saved = kgSaved(...)` against `averageMealKg(menu)`, from `src/worker/lib/insights.ts`.
- **`streak`:** `streak(times, at)`, where `at = week_end − 1` for last week and `at = now` for this week.
- **`rank`:** `{ rank, of }` from the range's standings, where `of` is the number of ranked students (points > 0). It is `null` if the student isn't ranked.
- **`under_budget_kg`:**
  - For last week only, it is `target − last_week` from `computeBudget`, rounded to 0.1.
  - It needs all three of these, and is otherwise null:
    - `createdAt + 7 days ≤` the week's start;
    - at least one activity with a non-null kg in the week;
    - a result greater than 0.
  - It is always null for this week. The card never says "over budget".
- **`first_name`** is the first whitespace-separated word of the display name. It is the only name in the payload.
- **Access:** `/api/me/recap` is for students only (`requireRole("student")`).
- **The image:**
  - 1080×1920 PNG, background `#f7f6f2`, accent `#2e7d50`, with the app's serif and sans stacks
  - no emoji
  - drawn after `document.fonts.ready`
- **Share and Download:**
  - **Share** uses `navigator.share({ files })` only when `navigator.canShare({ files })` is true. Otherwise only **Download** shows (`campus-carbon-week.png`).
  - An `AbortError` from the share sheet shows no error.
- **Imports** under `src/worker/lib` use explicit `.ts` extensions.

## Review Focus

1. **Activity but 0 points that week** (a capped photo meal, or a mock estimate): the recap isn't empty, `rank` is `null` (not "#undefined"), and the card leaves out the rank line. *Task 1 test.*
2. **First-week student** (last week empty, this week not): `/recap` opens on This week so far, and the card has no budget line. *Task 1 (budget null when not ready); Task 3 browser check.*
3. **Monday 00:05 SGT:** `last` is the week that just ended, and `this` is empty and says so. *Task 1 `recapRange` test.*
4. **A 30-character display name:** only the first word is used, and every canvas line is drawn with a max width so nothing runs off the image. *Task 1 `first_name` test; Task 3 `maxWidth` in the draw code.*
5. **Desktop browser or share sheet cancelled:** only Download shows when files can't be shared, and cancelling a share leaves the screen as it was. *Task 3 code and browser check.*

---

## File Structure

- **Create `src/worker/lib/recap.ts`:** `recapRange`, `buildRecap`, and the types `RecapWeek`, `RecapPayload`.
- **Modify `src/worker/lib/insights.ts`:** loosen `kgSaved`'s input type to a `MealLike` pick, so recap can pass `LoadedAct`s. No behaviour change.
- **Modify `src/worker/db.ts`:** `loadMenuKg(db)`, shared by `/impact` and `/me/recap`.
- **Modify `src/worker/routes/insights.ts`:** use `loadMenuKg`.
- **Create `src/worker/routes/recap.ts`:** `GET /me/recap`.
- **Modify `src/worker/app.ts`:** mount `recap`.
- **Modify `src/worker/routes/me.ts`:** add `recap_ready` to `/me/summary`.
- **Modify `src/app/copy.ts`:** `RecapData`, `recapLines()`.
- **Create `src/app/recapImage.ts`:** `drawRecap(data, origin): Promise<Blob>`.
- **Create `src/app/screens/Recap.tsx`.**
- **Modify `src/app/App.tsx`:** the `/recap` route, with no tab bar for students.
- **Modify `src/app/screens/Home.tsx`:** the "Your week in review" entry.
- **Tests:**
  - create `test/recap.test.ts` and `test/recap-routes.test.ts`
  - modify `test/copy.test.ts`
- **Docs:** modify `docs/demo-checklist.md` and the main spec §11.

---

### Task 1: Pure recap builder

**Files:**
- Create: `src/worker/lib/recap.ts`
- Modify: `src/worker/lib/insights.ts` (types of `verifiedMeals` and `kgSaved` only)
- Test: `test/recap.test.ts`

**Interfaces:**
- Consumes:
  - `periodPoints(acts: Act[], from: number, to: number, points?: MissionPoints): number` and `type Ranked = { user_id: string; display_name: string; points: number; rank: number }` from `./leaderboard.ts`
  - `kgSaved` from `./insights.ts`
  - `computeBudget` from `./budget.ts`
  - `streak(times: number[], now: number): number` from `./streak.ts`
  - `sgWeekStart` from `./time.ts`
  - `type Act`, `type MissionPoints` from `./missions.ts`
- Produces:
  - `type RecapWeek = "last" | "this"`
  - `recapRange(week: RecapWeek, now: number): { from: number; to: number; week_end: number }`
  - `type RecapAct = Act & { category: "food" | "mobility" | "waste"; kg_co2e: number | null }`
  - `type RecapPayload = { week: RecapWeek; week_start: number; week_end: number; first_name: string; empty: boolean; points: number; verified_meals: number; low_carbon_meals: number; kg_saved: number; walk_trips: number; byo: number; streak: number; rank: { rank: number; of: number } | null; under_budget_kg: number | null }`
  - `buildRecap(input: { week: RecapWeek; now: number; userId: string; displayName: string; createdAt: number; acts: RecapAct[]; avgMealKg: number | null; ranked: Ranked[]; points?: MissionPoints }): RecapPayload`

- [ ] **Step 1: Write the failing tests**

Create `test/recap.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { periodPoints } from "../src/worker/lib/leaderboard";
import { buildRecap, recapRange, type RecapAct } from "../src/worker/lib/recap";

const DAY = 86_400_000;
const H = 3_600_000;
const MON = Date.UTC(2026, 9, 4, 16); // Monday 5 Oct 2026 00:00 SGT
const NOW = MON + 2 * DAY + 13 * H; // Wednesday 13:00 SGT
const LAST = MON - 7 * DAY;

const act = (o: Partial<RecapAct> = {}): RecapAct => ({
  created_at: LAST + 2 * DAY + 12 * H, type: "meal", category: "food", low_carbon: 1, points: 20, verified: 1, kg_co2e: 0.4, detail: {}, ...o,
});
const base = { now: NOW, userId: "u", displayName: "Simon Tan", createdAt: MON - 30 * DAY, avgMealKg: 1, ranked: [] };

describe("recapRange", () => {
  it("last week is the previous SGT week; this week runs to now", () => {
    expect(recapRange("last", NOW)).toEqual({ from: LAST, to: MON, week_end: MON });
    expect(recapRange("this", NOW)).toEqual({ from: MON, to: NOW + 1, week_end: NOW });
  });
  it("at Monday 00:05 SGT, last week is the week that just ended", () => {
    const t = MON + 5 * 60_000;
    expect(recapRange("last", t)).toEqual({ from: LAST, to: MON, week_end: MON });
    expect(recapRange("this", t).from).toBe(MON);
  });
});

describe("buildRecap", () => {
  it("is empty with zeros and nulls when nothing was logged", () => {
    expect(buildRecap({ ...base, week: "last", acts: [] })).toEqual({
      week: "last", week_start: LAST, week_end: MON, first_name: "Simon", empty: true, points: 0, verified_meals: 0,
      low_carbon_meals: 0, kg_saved: 0, walk_trips: 0, byo: 0, streak: 0, rank: null, under_budget_kg: null,
    });
  });

  it("counts only the chosen week, with points as the leaderboard counts them", () => {
    const acts = [
      act({ created_at: MON - 2 * DAY + 12 * H, kg_co2e: 0.4 }), // Sat, low-carbon: saves 0.6
      act({ created_at: MON - DAY + 12 * H, low_carbon: 0, kg_co2e: 1.4, points: 0 }), // Sun, not low-carbon
      act({ created_at: MON - DAY + 9 * H, type: "trip", category: "mobility", low_carbon: null, kg_co2e: 0, points: 10, verified: 0, detail: { mode: "walk" } }),
      act({ created_at: MON - 2 * DAY + 13 * H, type: "byo", category: "waste", low_carbon: null, kg_co2e: null, points: 15 }),
      act({ created_at: MON + H }), // this week: excluded
    ];
    const ranked = [
      { user_id: "x", display_name: "X", points: 300, rank: 1 },
      { user_id: "u", display_name: "Simon Tan", points: 200, rank: 2 },
      { user_id: "y", display_name: "Y", points: 50, rank: 3 },
    ];
    const r = buildRecap({ ...base, week: "last", acts, ranked });
    expect(r).toMatchObject({ empty: false, verified_meals: 2, low_carbon_meals: 1, kg_saved: 0.6, walk_trips: 1, byo: 1, streak: 2, rank: { rank: 2, of: 3 } });
    expect(r.points).toBe(periodPoints(acts, LAST, MON));
    expect(r.points).toBeGreaterThan(0);
  });

  it("with activity but no points, is not empty and has no rank", () => {
    const r = buildRecap({ ...base, week: "last", acts: [act({ verified: 0, low_carbon: 1, points: 0 })], ranked: [{ user_id: "x", display_name: "X", points: 5, rank: 1 }] });
    expect(r.empty).toBe(false);
    expect(r.rank).toBeNull();
  });

  describe("under_budget_kg", () => {
    const created = MON - 21 * DAY; // baseline [MON-21d, MON-14d): 10 kg → target 8.5
    const baseline = act({ created_at: created + H, kg_co2e: 10, low_carbon: 0 });
    it("is target − last week when under", () => {
      const r = buildRecap({ ...base, createdAt: created, week: "last", acts: [baseline, act({ kg_co2e: 5, low_carbon: 0 })] });
      expect(r.under_budget_kg).toBe(3.5);
    });
    it("is null when over budget", () => {
      expect(buildRecap({ ...base, createdAt: created, week: "last", acts: [baseline, act({ kg_co2e: 9, low_carbon: 0 })] }).under_budget_kg).toBeNull();
    });
    it("is always null for this week", () => {
      expect(buildRecap({ ...base, createdAt: created, week: "this", acts: [baseline, act({ created_at: MON + H, kg_co2e: 1 })] }).under_budget_kg).toBeNull();
    });
    it("is null when the budget wasn't ready before the week began", () => {
      const late = MON - 10 * DAY; // ready at MON-3d, after last week started
      const acts = [act({ created_at: late + H, kg_co2e: 10, low_carbon: 0 }), act({ kg_co2e: 1, low_carbon: 0 })];
      expect(buildRecap({ ...base, createdAt: late, week: "last", acts }).under_budget_kg).toBeNull();
    });
  });

  it("counts the streak as of the end of last week, and as of now for this week", () => {
    const acts = [act({ created_at: MON - DAY + H }), act({ created_at: MON - 2 * DAY + H }), act({ created_at: MON - 3 * DAY + H })];
    expect(buildRecap({ ...base, week: "last", acts }).streak).toBe(3);
    // This week: Mon and Wed logged, Tue missing, so the streak as of Wed is 1.
    expect(buildRecap({ ...base, week: "this", acts: [...acts, act({ created_at: MON + H }), act({ created_at: NOW - H })] }).streak).toBe(1);
  });

  it("uses only the first word of the display name", () => {
    expect(buildRecap({ ...base, displayName: "  Bea   Lim Wei Ling ", week: "last", acts: [] }).first_name).toBe("Bea");
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run test/recap.test.ts`
Expected: FAIL, because `src/worker/lib/recap` can't be resolved.

- [ ] **Step 3: Loosen the insights input types (no behaviour change)**

In `src/worker/lib/insights.ts`:

1. After the `InsightAct` type, add:
   ```ts
   /** The fields kg-saved and meal counts need; recap passes plain activity rows. */
   export type MealLike = Pick<InsightAct, "type" | "verified" | "low_carbon" | "kg_co2e">;
   ```
2. Replace `const verifiedMeals = (acts: InsightAct[]) => ...` with:
   ```ts
   const verifiedMeals = <T extends MealLike>(acts: T[]) => acts.filter((a) => a.type === "meal" && a.verified === 1);
   ```
3. Change the `kgSaved` signature to `export function kgSaved(acts: MealLike[], avg: number | null): number {`. The body is unchanged.

Run: `npx vitest run test/insights.test.ts`. Expected: PASS, unchanged.

- [ ] **Step 4: Implement the builder**

Create `src/worker/lib/recap.ts`:

```ts
import { computeBudget } from "./budget.ts";
import { kgSaved } from "./insights.ts";
import { periodPoints, type Ranked } from "./leaderboard.ts";
import type { Act, MissionPoints } from "./missions.ts";
import { streak } from "./streak.ts";
import { sgWeekStart } from "./time.ts";

const WEEK = 7 * 86_400_000;

export type RecapWeek = "last" | "this";
export type RecapAct = Act & { category: "food" | "mobility" | "waste"; kg_co2e: number | null };
export type RecapPayload = {
  week: RecapWeek; week_start: number; week_end: number; first_name: string; empty: boolean; points: number;
  verified_meals: number; low_carbon_meals: number; kg_saved: number; walk_trips: number; byo: number; streak: number;
  rank: { rank: number; of: number } | null; under_budget_kg: number | null;
};

/** [from, to) of the recap week; week_end is what the card shows as the week's end. */
export function recapRange(week: RecapWeek, now: number): { from: number; to: number; week_end: number } {
  const cur = sgWeekStart(now);
  return week === "last" ? { from: cur - WEEK, to: cur, week_end: cur } : { from: cur, to: now + 1, week_end: now };
}

export function buildRecap(input: {
  week: RecapWeek; now: number; userId: string; displayName: string; createdAt: number;
  acts: RecapAct[]; avgMealKg: number | null; ranked: Ranked[]; points?: MissionPoints;
}): RecapPayload {
  const { week, now, userId, displayName, createdAt, acts, avgMealKg, ranked, points } = input;
  const { from, to, week_end } = recapRange(week, now);
  const inWeek = acts.filter((a) => a.created_at >= from && a.created_at < to);
  const meals = inWeek.filter((a) => a.type === "meal" && a.verified === 1);
  const mine = ranked.find((r) => r.user_id === userId);
  return {
    week,
    week_start: from,
    week_end,
    first_name: displayName.trim().split(/\s+/)[0] ?? "",
    empty: inWeek.length === 0,
    points: periodPoints(acts, from, to, points),
    verified_meals: meals.length,
    low_carbon_meals: meals.filter((a) => a.low_carbon === 1).length,
    kg_saved: kgSaved(inWeek, avgMealKg),
    walk_trips: inWeek.filter((a) => a.type === "trip" && a.detail.mode === "walk").length,
    byo: inWeek.filter((a) => a.type === "byo").length,
    streak: streak(acts.map((a) => a.created_at), week === "last" ? to - 1 : now),
    rank: mine ? { rank: mine.rank, of: ranked.length } : null,
    under_budget_kg: week === "last" ? underBy(createdAt, from, inWeek, acts, now) : null,
  };
}

/** Last week vs the student's budget; only when it was a full post-baseline week with kg logged, and only if under. */
function underBy(createdAt: number, from: number, inWeek: RecapAct[], acts: RecapAct[], now: number): number | null {
  if (createdAt + WEEK > from) return null;
  if (!inWeek.some((a) => a.kg_co2e != null)) return null;
  const b = computeBudget({ createdAt, now, acts });
  if (!b.ready) return null;
  const d = Math.round((b.overall.target - b.overall.last_week) * 10) / 10;
  return d > 0 ? d : null;
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run test/recap.test.ts test/insights.test.ts`
Expected: PASS.

Check the streak by hand. The acts fall on Fri, Sat and Sun of last week, and `at = MON − 1` (Sunday 23:59:59.999), so the streak is 3. Check that `kg_saved` is 0.6: 1.0 − 0.4.

- [ ] **Step 6: Commit**

```bash
git add src/worker/lib/recap.ts src/worker/lib/insights.ts test/recap.test.ts
git commit -m "feat(recap): pure weekly recap builder"
```

---

### Task 2: Recap endpoint and `recap_ready`

**Files:**
- Modify: `src/worker/db.ts` (add `loadMenuKg`)
- Modify: `src/worker/routes/insights.ts` (use `loadMenuKg`)
- Create: `src/worker/routes/recap.ts`
- Modify: `src/worker/app.ts`
- Modify: `src/worker/routes/me.ts`
- Test: `test/recap-routes.test.ts`

**Interfaces:**
- Consumes:
  - `buildRecap`, `recapRange`, `RecapWeek` from Task 1
  - `loadActs(db, { userId }): Promise<LoadedAct[]>` and `standings(db, from, to, points)` from `src/worker/acts.ts`
  - `loadMissionPoints(db)` from `src/worker/db.ts`
  - `averageMealKg` and `MenuItemKg` from `src/worker/lib/insights.ts`
- Produces:
  - `GET /api/me/recap?week=last|this` returns `RecapPayload`
  - `/api/me/summary` gains `recap_ready: boolean`
  - `loadMenuKg(db: D1Database): Promise<MenuItemKg[]>`

- [ ] **Step 1: Write the failing tests**

Create `test/recap-routes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { setup } from "./helpers/setup";

const fresh = async (ctx: Awaited<ReturnType<typeof setup>>, name = "Recap Student") =>
  (await ctx.req("/api/session", { body: { display_name: name } })).body.user.id as string;

describe("GET /api/me/recap", () => {
  it("is for students only", async () => {
    const ctx = await setup();
    for (const as of ["u-seller-noodles", "u-admin"]) expect((await ctx.req("/api/me/recap", { as })).status).toBe(403);
  });

  it("this week's points equal the leaderboard's", async () => {
    const ctx = await setup();
    const uid = await fresh(ctx);
    await ctx.req("/api/trips", { as: uid, body: { from_id: "hive", to_id: "north-spine", mode: "walk" } });
    const r = (await ctx.req("/api/me/recap?week=this", { as: uid })).body;
    const lb = (await ctx.req("/api/leaderboard", { as: uid })).body.me.points;
    expect(r.week).toBe("this");
    expect(r.empty).toBe(false);
    expect(r.walk_trips).toBe(1);
    expect(r.points).toBe(lb);
    expect(r.points).toBeGreaterThan(0);
    expect(r.first_name).toBe("Recap");
  });

  it("an unknown week means last week", async () => {
    const ctx = await setup();
    const uid = await fresh(ctx);
    const a = (await ctx.req("/api/me/recap?week=bogus", { as: uid })).body;
    const b = (await ctx.req("/api/me/recap", { as: uid })).body;
    expect(a.week).toBe("last");
    expect(b.week).toBe("last");
    expect(a.empty).toBe(true);
  });

  it("never contains another student's name or id", async () => {
    const ctx = await setup(); // seeded personas Alex, Bea, Chen have history
    const r = (await ctx.req("/api/me/recap", { as: "u-bea" })).body;
    expect(r.first_name).toBe("Bea");
    const text = JSON.stringify(r);
    for (const s of ["Alex", "Chen", "u-alex", "u-chen", "u-bea"]) expect(text).not.toContain(s);
  });
});

describe("/api/me/summary recap_ready", () => {
  it("is false for a brand-new student and true once they log something", async () => {
    const ctx = await setup();
    const uid = await fresh(ctx);
    expect((await ctx.req("/api/me/summary", { as: uid })).body.recap_ready).toBe(false);
    await ctx.req("/api/steps", { as: uid, body: { steps: 3000 } });
    expect((await ctx.req("/api/me/summary", { as: uid })).body.recap_ready).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run test/recap-routes.test.ts`
Expected: FAIL. The recap tests get 404 `not_found`, and `recap_ready` is `undefined`.

- [ ] **Step 3: Implement**

In `src/worker/db.ts`, add:

```ts
import type { MenuItemKg } from "./lib/insights";

/** Every item with its stall's active flag, for the average-campus-meal estimate. */
export async function loadMenuKg(db: D1Database): Promise<MenuItemKg[]> {
  const { results } = await db.prepare("SELECT i.kind, i.status, i.kg_co2e, s.active AS stall_active FROM items i JOIN stalls s ON s.id = i.stall_id").all<MenuItemKg>();
  return results;
}
```

In `src/worker/routes/insights.ts`:
- Replace the inline items query in `/impact`: `db.prepare("SELECT i.kind, i.status, i.kg_co2e, s.active AS stall_active FROM items i JOIN stalls s ON s.id = i.stall_id").all<MenuItemKg>(),` becomes `loadMenuKg(db),`.
- Change `averageMealKg(items.results)` to `averageMealKg(items)`.
- Import `loadMenuKg` from `"../db"`, and remove `MenuItemKg` from the insights import if it's now unused.

Create `src/worker/routes/recap.ts`:

```ts
import { Hono } from "hono";
import { loadActs, standings } from "../acts";
import { loadMenuKg, loadMissionPoints } from "../db";
import type { AppEnv } from "../env";
import { averageMealKg } from "../lib/insights";
import { buildRecap, recapRange, type RecapWeek } from "../lib/recap";
import { requireRole } from "../session";

export const recap = new Hono<AppEnv>();

recap.get("/me/recap", requireRole("student"), async (c) => {
  const db = c.env.DB;
  const user = c.get("user")!;
  const now = Date.now();
  const week: RecapWeek = c.req.query("week") === "this" ? "this" : "last";
  const { from, to } = recapRange(week, now);
  const points = await loadMissionPoints(db);
  const [acts, createdAt, menu, ranked] = await Promise.all([
    loadActs(db, { userId: user.id }),
    db.prepare("SELECT created_at FROM users WHERE id = ?").bind(user.id).first<number>("created_at"),
    loadMenuKg(db),
    standings(db, from, to, points),
  ]);
  return c.json(buildRecap({
    week, now, userId: user.id, displayName: user.display_name, createdAt: createdAt ?? now,
    acts, avgMealKg: averageMealKg(menu), ranked, points,
  }));
});
```

In `src/worker/app.ts`, add `import { recap } from "./routes/recap";` and `app.route("/", recap);` after `app.route("/", insights);`.

In `src/worker/routes/me.ts`, in the returned JSON, after `kg_week: ...,` add:

```ts
    recap_ready: myActs.some((a) => a.created_at >= weekStart - 7 * 86_400_000),
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run test/recap-routes.test.ts && npx vitest run && npm run typecheck`
Expected: all PASS, and typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/worker/db.ts src/worker/routes/insights.ts src/worker/routes/recap.ts src/worker/app.ts src/worker/routes/me.ts test/recap-routes.test.ts
git commit -m "feat(recap): /api/me/recap and recap_ready on Today"
```

---

### Task 3: Card text, drawing, `/recap` screen and the Today entry

**Files:**
- Modify: `src/app/copy.ts` (`RecapData`, `recapLines`)
- Test: `test/copy.test.ts`
- Create: `src/app/recapImage.ts`
- Create: `src/app/screens/Recap.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app/screens/Home.tsx`
- Modify: `src/app/screens/Impact.tsx` (link back to the app)

**Interfaces:**
- Consumes:
  - `GET /api/me/recap?week=` (`RecapPayload`) and `recap_ready` from Task 2
  - `weekLabel(ms)` from `src/app/copy.ts`
  - `api<T>(path, body?, opts?)` from `src/app/api.ts`
  - `navigate` from `src/app/router.ts`
- Produces:
  - `type RecapData` (the same shape as `RecapPayload`)
  - `recapLines(d: RecapData): { eyebrow: string; title: string; headline: string; headlineLabel: string; panels: { value: string; label: string }[]; extras: string[]; footnote: string }`
  - `drawRecap(d: RecapData, origin: string): Promise<Blob>`
  - `<Recap />`

- [ ] **Step 1: Write the failing copy tests**

Append to `test/copy.test.ts`:

```ts
import { recapLines, type RecapData } from "../src/app/copy";
describe("recapLines", () => {
  const MON = Date.UTC(2026, 9, 4, 16); // 5 Oct 2026 00:00 SGT
  const d: RecapData = {
    week: "last", week_start: MON, week_end: MON + 7 * 86_400_000, first_name: "Simon", empty: false, points: 185,
    verified_meals: 6, low_carbon_meals: 4, kg_saved: 2.3, walk_trips: 1, byo: 2, streak: 4, rank: { rank: 3, of: 24 }, under_budget_kg: 2.1,
  };
  it("lays out last week with dates, figures and every earned line", () => {
    const l = recapLines(d);
    expect(l.title).toBe("Simon · 5 Oct – 11 Oct");
    expect(l.headline).toBe("185");
    expect(l.headlineLabel).toBe("points last week");
    expect(l.panels).toEqual([
      { value: "4 of 6", label: "low-carbon meals" },
      { value: "≈ 2.3 kg", label: "CO₂e saved (est.)" },
      { value: "1", label: "walk" },
      { value: "2", label: "own cups and containers" },
    ]);
    expect(l.extras).toEqual(["4-day streak", "#3 of 24 last week", "2.1 kg under my budget"]);
  });
  it("this week says so far and currently, and drops lines that don't apply", () => {
    const l = recapLines({ ...d, week: "this", streak: 1, rank: null, under_budget_kg: null, walk_trips: 3 });
    expect(l.title).toBe("Simon · this week so far");
    expect(l.headlineLabel).toBe("points so far");
    expect(l.panels[2]).toEqual({ value: "3", label: "walks" });
    expect(l.extras).toEqual([]);
    expect(recapLines({ ...d, week: "this" }).extras).toContain("currently #3 of 24");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run test/copy.test.ts`
Expected: FAIL, because `recapLines` is not a function.

- [ ] **Step 3: Implement `recapLines`**

Append to `src/app/copy.ts`:

```ts
export type RecapData = {
  week: "last" | "this"; week_start: number; week_end: number; first_name: string; empty: boolean; points: number;
  verified_meals: number; low_carbon_meals: number; kg_saved: number; walk_trips: number; byo: number; streak: number;
  rank: { rank: number; of: number } | null; under_budget_kg: number | null;
};

/** Everything the recap image says, decided here so it can be tested without a canvas. */
export function recapLines(d: RecapData) {
  const last = d.week === "last";
  const range = last ? `${weekLabel(d.week_start)} – ${weekLabel(d.week_end - 1)}` : "this week so far";
  return {
    eyebrow: "CAMPUS CARBON",
    title: `${d.first_name} · ${range}`,
    headline: String(d.points),
    headlineLabel: last ? "points last week" : "points so far",
    panels: [
      { value: `${d.low_carbon_meals} of ${d.verified_meals}`, label: "low-carbon meals" },
      { value: `≈ ${d.kg_saved} kg`, label: "CO₂e saved (est.)" },
      { value: String(d.walk_trips), label: d.walk_trips === 1 ? "walk" : "walks" },
      { value: String(d.byo), label: "own cups and containers" },
    ],
    extras: [
      d.streak >= 2 ? `${d.streak}-day streak` : null,
      d.rank ? (last ? `#${d.rank.rank} of ${d.rank.of} last week` : `currently #${d.rank.rank} of ${d.rank.of}`) : null,
      last && d.under_budget_kg != null ? `${d.under_budget_kg} kg under my budget` : null,
    ].filter((x): x is string => x !== null),
    footnote: "kg saved is an estimate vs an average campus meal",
  };
}
```

Run: `npx vitest run test/copy.test.ts`. Expected: PASS.

- [ ] **Step 4: Implement the drawing**

Create `src/app/recapImage.ts`:

```ts
import QRCode from "qrcode";
import { recapLines, type RecapData } from "./copy";

const W = 1080;
const H = 1920;
const M = 96; // side margin
const SERIF = 'ui-serif, "New York", "Iowan Old Style", Georgia, serif';
const SANS = '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Story-sized PNG of the student's week, drawn on the phone (nothing is uploaded). */
export async function drawRecap(d: RecapData, origin: string): Promise<Blob> {
  await document.fonts?.ready;
  const L = recapLines(d);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const text = (s: string, x: number, y: number, font: string, color: string, maxWidth = W - 2 * M) => {
    g.font = font;
    g.fillStyle = color;
    g.textAlign = "left";
    g.fillText(s, x, y, maxWidth); // maxWidth squeezes long names instead of running off the card
  };

  g.fillStyle = "#f7f6f2";
  g.fillRect(0, 0, W, H);

  text(L.eyebrow, M, 180, `600 34px ${SANS}`, "#8e8e93");
  text(L.title, M, 250, `44px ${SANS}`, "#1c1c1e");
  text(L.headline, M, 560, `260px ${SERIF}`, "#2e7d50");
  text(L.headlineLabel, M, 640, `44px ${SANS}`, "#6e6e73");

  const pw = 420;
  const ph = 260;
  const gap = 48;
  const top = 740;
  L.panels.forEach((p, i) => {
    const x = M + (i % 2) * (pw + gap);
    const y = top + Math.floor(i / 2) * (ph + gap);
    g.fillStyle = "#ecebe6";
    g.beginPath();
    g.roundRect(x, y, pw, ph, 40);
    g.fill();
    text(p.value, x + 40, y + 130, `84px ${SERIF}`, "#1c1c1e", pw - 80);
    text(p.label, x + 40, y + 200, `34px ${SANS}`, "#6e6e73", pw - 80);
  });

  let y = top + 2 * ph + gap + 110;
  for (const e of L.extras) {
    text(e, M, y, `44px ${SANS}`, "#1c1c1e");
    y += 70;
  }

  const qrSize = 240;
  const qr = await loadImage(await QRCode.toDataURL(`${origin}/`, { margin: 1, width: qrSize }));
  g.drawImage(qr, W - M - qrSize, H - M - qrSize, qrSize, qrSize);
  text("Join at", M, H - 250, `36px ${SANS}`, "#6e6e73", 560);
  text(new URL(origin).host, M, H - 195, `44px ${SANS}`, "#1c1c1e", 560);
  text(L.footnote, M, H - 110, `28px ${SANS}`, "#8e8e93", 560);

  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"));
}
```

- [ ] **Step 5: Build the screen, route and Today entry**

Create `src/app/screens/Recap.tsx`:

```tsx
import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import type { RecapData } from "../copy";
import { drawRecap } from "../recapImage";
import { navigate } from "../router";

type Week = "last" | "this";

export function Recap() {
  const [week, setWeek] = useState<Week | null>(null);
  const [data, setData] = useState<RecapData | null>(null);
  const [png, setPng] = useState<{ blob: Blob; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = (w: Week) => api<RecapData>(`/me/recap?week=${w}`);

  // Open on last week; a student with nothing last week (first week) opens on this week.
  useEffect(() => {
    (async () => {
      const last = await load("last");
      if (!last.empty) return [last, "last"] as const;
      const cur = await load("this");
      return cur.empty ? ([last, "last"] as const) : ([cur, "this"] as const);
    })()
      .then(([d, w]) => {
        setData(d);
        setWeek(w);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load your week."));
  }, []);

  useEffect(() => {
    setPng(null);
    if (!data || data.empty) return;
    let url = "";
    let gone = false;
    drawRecap(data, location.origin)
      .then((blob) => {
        if (gone) return;
        url = URL.createObjectURL(blob);
        setPng({ blob, url });
      })
      .catch(() => setError("Couldn't draw the card."));
    return () => {
      gone = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [data]);

  async function pick(w: Week) {
    if (w === week) return;
    setWeek(w);
    setError(null);
    try {
      setData(await load(w));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load your week.");
    }
  }

  const file = png ? new File([png.blob], "campus-carbon-week.png", { type: "image/png" }) : null;
  const canShare = !!file && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });

  async function share() {
    if (!file) return;
    try {
      await navigator.share({ files: [file], title: "My week on Campus Carbon" });
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError("Couldn't share. Use Download instead.");
    }
  }

  return (
    <>
      <div>
        <button className="link-btn" onClick={() => navigate("/")}>‹ Today</button>
        <h1 className="display" style={{ marginTop: 8 }}>Your week in review</h1>
      </div>
      <div className="segmented" role="group" aria-label="Which week">
        <button aria-pressed={week === "last"} onClick={() => pick("last")}>Last week</button>
        <button aria-pressed={week === "this"} onClick={() => pick("this")}>This week so far</button>
      </div>
      {error && <p className="error">{error}</p>}
      {data?.empty ? (
        <p className="body" style={{ textAlign: "center", padding: "48px 0" }}>Nothing logged that week.</p>
      ) : png ? (
        <>
          <img src={png.url} alt="Your week as a shareable card" style={{ width: "100%", borderRadius: 18, boxShadow: "0 1px 0 var(--line)" }} />
          {canShare && <button className="btn" onClick={share}>Share</button>}
          <a className={canShare ? "btn btn-secondary" : "btn"} style={{ textAlign: "center", textDecoration: "none" }} href={png.url} download="campus-carbon-week.png">Download</a>
        </>
      ) : (
        !error && <p className="muted" style={{ textAlign: "center" }}>Drawing your card…</p>
      )}
    </>
  );
}
```

In `src/app/App.tsx`:
1. Add `import { Recap } from "./screens/Recap";`.
2. Change `const main = path !== "/claim" && path !== "/tap" && !path.startsWith("/admin");` to:
   ```tsx
   const main = path !== "/claim" && path !== "/tap" && !(student && path === "/recap") && !path.startsWith("/admin");
   ```
   `student` must be declared before `main`. It is already: `const student = role === "student";` comes first.
3. Add `{path === "/recap" && student && <Recap />}` after `{path === "/tap" && <Tap />}`.

In `src/app/screens/Home.tsx`:
1. Add `recap_ready: boolean;` to the `Summary` type.
2. Add `import { navigate } from "../router";`.
3. In the main view, directly after the closing `</div>` of the `.week` dots block, add:

```tsx
      {data.recap_ready && (
        <button className="card" onClick={() => navigate("/recap")} style={{ border: 0, textAlign: "left", cursor: "pointer", width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="title" style={{ fontSize: 18 }}>Your week in review</span>
          <span className="muted">Share ›</span>
        </button>
      )}
```

Also link Today to the campus impact page (user request, 2026-10-07):

1. In `src/app/screens/Home.tsx`, at the end of the main view (after the recent-activity `.list` div), add:

   ```tsx
         <button className="link-btn" style={{ alignSelf: "center" }} onClick={() => navigate("/impact")}>See campus impact ›</button>
   ```

2. Add the same button at the end of `FirstVisit`'s returned fragment, after the "For stalls without a code" paragraph.

3. In `src/app/screens/Impact.tsx`, inside `.impact-foot`'s first `<div>`, after the "NTU CC0006 pilot · updated" line, add a way back for students who came from Today. On the projector it stays small:

   ```tsx
             <button className="link-btn" style={{ marginTop: 8 }} onClick={() => navigate("/")}>Open Campus Carbon</button>
   ```

   Add `import { navigate } from "../router";` to `Impact.tsx`.

- [ ] **Step 6: Check it in the browser**

1. `npm run typecheck && npx vitest run`. Expected: all pass.
2. In the dev preview at 375 px, as a seeded student with history (switch to Bea via `/admin`):
   - Expected: Today shows "Your week in review" under the week dots.
   - Tap it. Expected: `/recap` has no tab bar, the switch is on Last week, and a preview card is drawn.
3. Run `javascript_tool`: `const i=document.querySelector('img[alt^="Your week"]'); [i.naturalWidth, i.naturalHeight]`. Expected: `[1080, 1920]`.
4. Tap "This week so far". Expected: the card redraws, or "Nothing logged that week."
5. Desktop pane: `navigator.canShare` with files is normally false here. Expected: only Download shows (Review Focus 5).
6. Today → "See campus impact ›" opens `/impact`, and "Open Campus Carbon" there returns to Today.
7. Read the preview text lines: the eyebrow, "Bea · …", the headline, the panels, the footnote and the QR code. Nothing should run off the right edge (Review Focus 4).

- [ ] **Step 7: Commit**

```bash
git add src/app/copy.ts test/copy.test.ts src/app/recapImage.ts src/app/screens/Recap.tsx src/app/App.tsx src/app/screens/Home.tsx src/app/screens/Impact.tsx
git commit -m "feat(app): weekly recap card with share and download"
```

---

### Task 4: Docs, deploy and smoke test

**Files:**
- Modify: `docs/demo-checklist.md`
- Modify: `docs/superpowers/specs/2026-09-29-campus-carbon-app-design.md` (§11 Screens)

- [ ] **Step 1: Update the docs**

In `docs/demo-checklist.md`, under "Stage 2–4 checks (real phones)", after the projector line, add:

```markdown
- [ ] Recap card: Today → "Your week in review" → Share → Instagram Story (iPhone and Android) shows the 1080×1920 card; WhatsApp sends it as an image; on a laptop the button is Download
```

In the main spec, at the end of §11 Screens (after the impact and insights line), add:

```markdown
- **Weekly recap card** (`/recap`, students): see `2026-10-07-weekly-recap-card-design.md`.
```

- [ ] **Step 2: Deploy and smoke test**

There is no migration in this plan. Run:

```bash
npm run deploy
curl -s -o /dev/null -w "%{http_code}\n" https://campus-carbon.stan322.workers.dev/api/me/recap
```

Expected: `401`. With no session, `requireRole` answers 401.

- [ ] **Step 3: Commit**

```bash
git add docs/demo-checklist.md docs/superpowers/specs/2026-09-29-campus-carbon-app-design.md
git commit -m "docs: recap card checklist and spec pointer"
```
