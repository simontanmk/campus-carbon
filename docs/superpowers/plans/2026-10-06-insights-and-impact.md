# Insights and Campus Impact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public `/impact` page of campus totals, an admin insights page, and a "Your stall this week" panel for sellers. All are computed on read from existing activity.

**Architecture:**
- One pure module, `src/worker/lib/insights.ts`, turns activity rows into the three payloads. It has no database access and is unit tested.
- One route file, `src/worker/routes/insights.ts`, loads rows with bounded queries and calls it.
- Three React screens consume the endpoints.
- No migration and no stored aggregates.

**Tech Stack:**
- Cloudflare Worker + Hono, D1
- React 19 + Vite
- Vitest on the `node:sqlite` D1 adapter
- `qrcode` (already a dependency)

**Spec:** `docs/superpowers/specs/2026-10-06-insights-and-impact-design.md` (extends `docs/superpowers/specs/2026-09-29-campus-carbon-app-design.md`).

## Global Constraints

- **Weeks** are SGT weeks starting Monday 00:00 SGT (`sgWeekStart` in `src/worker/lib/time.ts`). "This week" runs from the week start to now.
- **Verified meal:** `type = 'meal' AND verified = 1`. Photo meals (`verified = 0`) never count in shares or savings.
- **Low-carbon share:** verified low-carbon meals ÷ verified meals. It is `null` when there are no verified meals, and the UI shows "—".
- **Average campus meal (kg):** the mean kg of items with `kind='meal'`, `status='live'`, non-null kg, at active stalls (`stalls.active = 1`). It is `null` when there are none.
- **Estimated kg saved:** the sum over verified low-carbon meals with a known kg of `max(0, average − meal kg)`, rounded to 0.1. It is 0 when the average is null.
- **The label always says** "estimated, vs an average campus meal".
- **Under budget (last week):**
  - **Who counts:** students with a ready budget (`computeBudget`) and at least one activity with non-null kg in last week's range.
  - **Under** means `overall.last_week ≤ overall.target`.
  - **`kg_below`** is the sum of `target − last_week` over those students, rounded to 0.1.
  - It is `null` when no student qualifies.
- **8-week window:** the current week and the 7 before it, oldest first.
- **`/api/impact`:**
  - public, no session needed
  - header `Cache-Control: public, max-age=30`
  - never returns names, user ids or stall ids
- **`/api/stall/insights`** uses the session's `stall_id` only and accepts no stall parameter.
- **Rounding:** shares and kg averages to 2 decimals; kg saved and kg below to 1 decimal.
- **Visual language:** off-white, serif numbers, one green accent (`var(--accent)`). No chart library: charts are inline SVG.
- **Imports** under `src/worker/lib` use explicit `.ts` extensions (the seed runs under Node type stripping).

## Review Focus

1. **Empty campus** (fresh deploy, or Monday 00:05 with nothing logged): `/impact` returns 0 kg saved, a share of `null`, 0 counts and 8 week rows, with no NaN. The page shows "—" and "0".
2. **Privacy of the public endpoint:** with real activity present, the `/api/impact` JSON contains no user id, display name or stall id. A poster QR code must be safe.
3. **Wrong viewer:**
   - a switched persona, student or seller calling `/api/admin/insights` gets 403
   - a seller adding `?stall_id=other` to `/api/stall/insights` still sees only their own stall
4. **No priced menu** (no live meals with a kg at active stalls): the average is null, kg saved is 0, and the page hides the "(1.12 kg)" part instead of showing "null".
5. **Week boundary:** an activity at exactly Monday 00:00 SGT belongs to that week, not the previous one, in both the current-week figures and the 8-week rows.

Each line has a test in the task that owns the code:
- 1, 4 and 5 in Task 1
- 1, 2 and 3 in Task 2
- the empty-campus display in Task 3's browser check

---

## File Structure

- **Create `src/worker/lib/insights.ts`:** pure calculations and payload builders (`weekStarts`, `lowCarbonShare`, `averageMealKg`, `kgSaved`, `stats`, `underBudget`, `impact`, `adminInsights`, `stallInsights`).
- **Create `src/worker/routes/insights.ts`:** `GET /impact`, `GET /admin/insights`, `GET /stall/insights`, plus the row loader.
- **Modify `src/worker/app.ts`:** mount `insights`.
- **Create `src/app/screens/Impact.tsx`:** the public projector page, including the `WeekBars` SVG.
- **Create `src/app/screens/AdminInsights.tsx`:** the admin dashboard.
- **Modify `src/app/screens/Stall.tsx`:** the `StallWeek` panel.
- **Modify `src/app/screens/Admin.tsx`:** the "Insights" button.
- **Modify `src/app/App.tsx`:** render `/impact` before the Welcome gate; route `/admin/insights`.
- **Modify `src/app/copy.ts`:** `pct()` and `weekLabel()`.
- **Modify `src/app/styles.css`:** `.impact` layout and the chart.
- **Tests:**
  - create `test/insights.test.ts` (pure) and `test/insights-routes.test.ts` (routes)
  - modify `test/copy.test.ts`
- **Docs:** modify `docs/demo-checklist.md`, and the main spec §11 (screens list).

---

### Task 1: Pure insights module

**Files:**
- Create: `src/worker/lib/insights.ts`
- Test: `test/insights.test.ts`

**Interfaces:**
- Consumes:
  - `computeBudget(input: { createdAt: number; now: number; acts: { created_at: number; category: "food" | "mobility" | "waste"; kg_co2e: number | null }[] }): Budget` from `./budget.ts`. `Budget` is `{ ready: false, ... }` or `{ ready: true; overall: { target; used; remaining; last_week }; ... }`.
  - `sgWeekStart(ms): number` from `./time.ts`.
- Produces:
  - `type InsightAct = { user_id: string; created_at: number; type: string; source: string; verified: number; low_carbon: number | null; kg_co2e: number | null; stall_id: string | null; item_name: string | null; detail: Record<string, unknown> }`
  - `type Stats = { meals: number; low_carbon_share: number | null; avg_kg: number | null; byo: number }`
  - `type MenuItemKg = { kind: string; status: string; kg_co2e: number | null; stall_active: number }`
  - `type BudgetRow = { user_id: string; user_created_at: number; created_at: number; category: "food" | "mobility" | "waste"; kg_co2e: number | null }`
  - `weekStarts(now: number, n?: number): number[]`
  - `lowCarbonShare(acts: InsightAct[]): number | null`
  - `averageMealKg(items: MenuItemKg[]): number | null`
  - `kgSaved(acts: InsightAct[], avg: number | null): number`
  - `stats(acts: InsightAct[]): Stats`
  - `underBudget(rows: BudgetRow[], now: number): { students: number; of: number; kg_below: number } | null`
  - `impact(input: { acts: InsightAct[]; avgMealKg: number | null; budgetRows: BudgetRow[]; now: number }): ImpactPayload`
  - `adminInsights(input: { acts: InsightAct[]; stalls: { id: string; name: string }[]; now: number }): AdminPayload`
  - `stallInsights(acts: InsightAct[], stallId: string, now: number): { this_week: Stats; last_week: Stats }`
  - `ImpactPayload` and `AdminPayload` exactly as in spec §4.1 and §4.2.

- [ ] **Step 1: Write the failing tests**

Create `test/insights.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  adminInsights, averageMealKg, impact, kgSaved, lowCarbonShare, stallInsights, stats, underBudget, weekStarts,
  type BudgetRow, type InsightAct,
} from "../src/worker/lib/insights";

const DAY = 86_400_000;
const H = 3_600_000;
const MON = Date.UTC(2026, 9, 4, 16); // Monday 5 Oct 2026 00:00 SGT
const NOW = MON + 2 * DAY + 13 * H; // Wednesday 13:00 SGT

let n = 0;
const act = (o: Partial<InsightAct> = {}): InsightAct => ({
  user_id: `u${n++ % 3}`, created_at: NOW - H, type: "meal", source: "qr", verified: 1, low_carbon: 1, kg_co2e: 0.4,
  stall_id: "noodles", item_name: "Veg noodles", detail: {}, ...o,
});

describe("weekStarts", () => {
  it("returns 8 SGT Mondays, oldest first, ending with this week", () => {
    const w = weekStarts(NOW);
    expect(w).toHaveLength(8);
    expect(w[7]).toBe(MON);
    expect(w[0]).toBe(MON - 7 * 7 * DAY);
  });
});

describe("lowCarbonShare", () => {
  it("is null with no verified meals", () => {
    expect(lowCarbonShare([])).toBeNull();
    expect(lowCarbonShare([act({ verified: 0, source: "photo" })])).toBeNull();
  });
  it("counts only verified meals", () => {
    const acts = [act(), act({ low_carbon: 0, kg_co2e: 1.4 }), act({ verified: 0, source: "photo" }), act({ type: "byo", low_carbon: null, kg_co2e: null })];
    expect(lowCarbonShare(acts)).toBe(0.5);
  });
});

describe("averageMealKg", () => {
  it("averages live meals with a kg at active stalls only", () => {
    expect(averageMealKg([
      { kind: "meal", status: "live", kg_co2e: 1, stall_active: 1 },
      { kind: "meal", status: "live", kg_co2e: 2, stall_active: 1 },
      { kind: "meal", status: "draft", kg_co2e: 9, stall_active: 1 },
      { kind: "meal", status: "live", kg_co2e: 9, stall_active: 0 },
      { kind: "drink", status: "live", kg_co2e: 9, stall_active: 1 },
      { kind: "meal", status: "live", kg_co2e: null, stall_active: 1 },
    ])).toBe(1.5);
  });
  it("is null with no priced live meals", () => {
    expect(averageMealKg([{ kind: "meal", status: "live", kg_co2e: null, stall_active: 1 }])).toBeNull();
  });
});

describe("kgSaved", () => {
  it("adds avg − kg for verified low-carbon meals, never negative, never photo meals", () => {
    const acts = [
      act({ kg_co2e: 0.4 }), // 1.0 - 0.4 = 0.6
      act({ kg_co2e: 1.3 }), // heavier than average: 0
      act({ low_carbon: 0, kg_co2e: 0.2 }), // not low-carbon: 0
      act({ verified: 0, source: "photo", kg_co2e: 0.1 }), // photo: 0
      act({ kg_co2e: null }), // unknown kg: 0
    ];
    expect(kgSaved(acts, 1.0)).toBe(0.6);
  });
  it("is 0 when there is no average", () => {
    expect(kgSaved([act()], null)).toBe(0);
  });
});

describe("stats", () => {
  it("summarises one stall's verified meals and BYO", () => {
    expect(stats([act({ kg_co2e: 0.4 }), act({ low_carbon: 0, kg_co2e: 1.4 }), act({ type: "byo", low_carbon: null, kg_co2e: null })]))
      .toEqual({ meals: 2, low_carbon_share: 0.5, avg_kg: 0.9, byo: 1 });
  });
  it("has null share and avg with no meals", () => {
    expect(stats([])).toEqual({ meals: 0, low_carbon_share: null, avg_kg: null, byo: 0 });
  });
});

describe("underBudget", () => {
  const created = MON - 14 * DAY; // budget ready; first week = [MON-14d, MON-7d)
  const row = (user_id: string, created_at: number, kg: number | null): BudgetRow => ({ user_id, user_created_at: created, created_at, category: "food", kg_co2e: kg });
  it("compares last week's kg with the target for students active last week", () => {
    const rows = [
      row("a", created + H, 10), row("a", MON - 3 * DAY, 5), // target 8.5, last week 5 → under by 3.5
      row("b", created + H, 10), row("b", MON - 3 * DAY, 9), // last week 9 > 8.5 → over
      row("c", created + H, 10), // no activity last week → not counted
    ];
    expect(underBudget(rows, NOW)).toEqual({ students: 1, of: 2, kg_below: 3.5 });
  });
  it("skips students still in their first week, and is null when nobody qualifies", () => {
    const fresh: BudgetRow = { user_id: "d", user_created_at: NOW - DAY, created_at: NOW - H, category: "food", kg_co2e: 1 };
    expect(underBudget([fresh], NOW)).toBeNull();
    expect(underBudget([], NOW)).toBeNull();
  });
});

describe("impact", () => {
  it("is all zeros and nulls on an empty campus, with 8 week rows", () => {
    const p = impact({ acts: [], avgMealKg: null, budgetRows: [], now: NOW });
    expect(p).toMatchObject({ week_start: MON, generated_at: NOW, avg_meal_kg: null, kg_saved: 0, low_carbon_share: null, verified_meals: 0, active_students: 0, walk_trips: 0, byo: 0, under_budget: null });
    expect(p.weeks).toHaveLength(8);
    expect(p.weeks.every((w) => w.low_carbon_share === null && w.kg_saved === 0)).toBe(true);
  });

  it("counts this week only, with an activity at Monday 00:00 SGT in this week", () => {
    const acts = [
      act({ user_id: "a", created_at: MON, kg_co2e: 0.4 }), // exactly the boundary: this week
      act({ user_id: "b", created_at: MON - 1, kg_co2e: 0.4 }), // last week
      act({ user_id: "a", type: "trip", low_carbon: null, kg_co2e: 0, detail: { mode: "walk" }, stall_id: null }),
      act({ user_id: "c", type: "byo", low_carbon: null, kg_co2e: null }),
    ];
    const p = impact({ acts, avgMealKg: 1, budgetRows: [], now: NOW });
    expect(p).toMatchObject({ kg_saved: 0.6, low_carbon_share: 1, verified_meals: 1, active_students: 2, walk_trips: 1, byo: 1 });
    expect(p.weeks[7]).toEqual({ week_start: MON, low_carbon_share: 1, kg_saved: 0.6 });
    expect(p.weeks[6]).toEqual({ week_start: MON - 7 * DAY, low_carbon_share: 1, kg_saved: 0.6 });
  });
});

describe("adminInsights", () => {
  it("gives per-stall this/last week, top dishes and the 8-week table", () => {
    const acts = [
      act({ item_name: "Veg noodles" }), act({ item_name: "Veg noodles" }),
      act({ item_name: "Chicken rice", low_carbon: 0, kg_co2e: 1.36 }),
      act({ stall_id: "econ-rice", item_name: "2 veg + egg", created_at: MON - DAY }),
      act({ type: "meal", source: "photo", verified: 0, stall_id: null, item_name: null }),
      act({ type: "trip", stall_id: null, item_name: null, low_carbon: null, kg_co2e: 0.5, detail: { mode: "shuttle" } }),
    ];
    const p = adminInsights({ acts, stalls: [{ id: "econ-rice", name: "Economy Rice" }, { id: "noodles", name: "Noodles" }], now: NOW });
    expect(p.stalls[0]).toEqual({ id: "econ-rice", name: "Economy Rice", this_week: { meals: 0, low_carbon_share: null, avg_kg: null, byo: 0 }, last_week: { meals: 1, low_carbon_share: 1, avg_kg: 0.4, byo: 0 } });
    expect(p.stalls[1].this_week).toEqual({ meals: 3, low_carbon_share: 0.67, avg_kg: 0.72, byo: 0 });
    expect(p.top_dishes).toEqual([{ name: "Veg noodles", count: 2, low_carbon: true }, { name: "Chicken rice", count: 1, low_carbon: false }]);
    expect(p.weeks).toHaveLength(8);
    expect(p.weeks[7]).toEqual({ week_start: MON, verified_meals: 3, low_carbon_share: 0.67, photo_meals: 1, trips: { walk: 0, shuttle: 1, car: 0 } });
  });
});

describe("stallInsights", () => {
  it("only looks at the given stall", () => {
    const acts = [act({ stall_id: "noodles" }), act({ stall_id: "econ-rice" }), act({ stall_id: "noodles", created_at: MON - DAY, low_carbon: 0, kg_co2e: 2 })];
    expect(stallInsights(acts, "noodles", NOW)).toEqual({
      this_week: { meals: 1, low_carbon_share: 1, avg_kg: 0.4, byo: 0 },
      last_week: { meals: 1, low_carbon_share: 0, avg_kg: 2, byo: 0 },
    });
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run test/insights.test.ts`
Expected: FAIL, because `src/worker/lib/insights` can't be resolved.

- [ ] **Step 3: Implement the module**

Create `src/worker/lib/insights.ts`:

```ts
import { computeBudget } from "./budget.ts";
import { sgWeekStart } from "./time.ts";

const WEEK = 7 * 86_400_000;
export const WEEKS = 8;

export type InsightAct = {
  user_id: string; created_at: number; type: string; source: string; verified: number; low_carbon: number | null;
  kg_co2e: number | null; stall_id: string | null; item_name: string | null; detail: Record<string, unknown>;
};
export type Stats = { meals: number; low_carbon_share: number | null; avg_kg: number | null; byo: number };
export type MenuItemKg = { kind: string; status: string; kg_co2e: number | null; stall_active: number };
export type BudgetRow = { user_id: string; user_created_at: number; created_at: number; category: "food" | "mobility" | "waste"; kg_co2e: number | null };
export type UnderBudget = { students: number; of: number; kg_below: number };
export type ImpactPayload = {
  week_start: number; generated_at: number; avg_meal_kg: number | null; kg_saved: number; low_carbon_share: number | null;
  verified_meals: number; active_students: number; walk_trips: number; byo: number; under_budget: UnderBudget | null;
  weeks: { week_start: number; low_carbon_share: number | null; kg_saved: number }[];
};
export type AdminPayload = {
  stalls: { id: string; name: string; this_week: Stats; last_week: Stats }[];
  top_dishes: { name: string; count: number; low_carbon: boolean }[];
  weeks: { week_start: number; verified_meals: number; low_carbon_share: number | null; photo_meals: number; trips: { walk: number; shuttle: number; car: number } }[];
};

const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const inRange = (acts: InsightAct[], from: number, to: number) => acts.filter((a) => a.created_at >= from && a.created_at < to);
const verifiedMeals = (acts: InsightAct[]) => acts.filter((a) => a.type === "meal" && a.verified === 1);

/** The current SGT week and the n−1 before it, oldest first. */
export function weekStarts(now: number, n = WEEKS): number[] {
  const cur = sgWeekStart(now);
  return Array.from({ length: n }, (_, i) => cur - (n - 1 - i) * WEEK);
}

export function lowCarbonShare(acts: InsightAct[]): number | null {
  const meals = verifiedMeals(acts);
  return meals.length ? r2(meals.filter((a) => a.low_carbon === 1).length / meals.length) : null;
}

/** Mean kg of today's live, priced meals at active stalls: the "average campus meal" savings are measured against. */
export function averageMealKg(items: MenuItemKg[]): number | null {
  const kgs = items.filter((i) => i.kind === "meal" && i.status === "live" && i.stall_active === 1 && i.kg_co2e != null).map((i) => i.kg_co2e!);
  return kgs.length ? r2(mean(kgs)) : null;
}

/** Estimated kg saved: each verified low-carbon meal vs the average campus meal, never below zero. */
export function kgSaved(acts: InsightAct[], avg: number | null): number {
  if (avg == null) return 0;
  return r1(verifiedMeals(acts).reduce((n, a) => (a.low_carbon === 1 && a.kg_co2e != null ? n + Math.max(0, avg - a.kg_co2e) : n), 0));
}

export function stats(acts: InsightAct[]): Stats {
  const meals = verifiedMeals(acts);
  const kgs = meals.filter((a) => a.kg_co2e != null).map((a) => a.kg_co2e!);
  return { meals: meals.length, low_carbon_share: lowCarbonShare(acts), avg_kg: kgs.length ? r2(mean(kgs)) : null, byo: acts.filter((a) => a.type === "byo").length };
}

/** Last full week vs each student's budget target; only students with a ready budget who logged kg last week. */
export function underBudget(rows: BudgetRow[], now: number): UnderBudget | null {
  const lastStart = sgWeekStart(now) - WEEK;
  const byUser = new Map<string, BudgetRow[]>();
  for (const r of rows) {
    const list = byUser.get(r.user_id);
    if (list) list.push(r);
    else byUser.set(r.user_id, [r]);
  }
  let of = 0;
  let students = 0;
  let below = 0;
  for (const list of byUser.values()) {
    if (!list.some((r) => r.kg_co2e != null && r.created_at >= lastStart && r.created_at < lastStart + WEEK)) continue;
    const b = computeBudget({ createdAt: list[0].user_created_at, now, acts: list });
    if (!b.ready) continue;
    of++;
    if (b.overall.last_week <= b.overall.target) {
      students++;
      below += b.overall.target - b.overall.last_week;
    }
  }
  return of ? { students, of, kg_below: r1(below) } : null;
}

export function impact(input: { acts: InsightAct[]; avgMealKg: number | null; budgetRows: BudgetRow[]; now: number }): ImpactPayload {
  const { acts, avgMealKg, budgetRows, now } = input;
  const weeks = weekStarts(now);
  const cur = weeks[weeks.length - 1];
  const week = inRange(acts, cur, now + 1);
  return {
    week_start: cur,
    generated_at: now,
    avg_meal_kg: avgMealKg,
    kg_saved: kgSaved(week, avgMealKg),
    low_carbon_share: lowCarbonShare(week),
    verified_meals: verifiedMeals(week).length,
    active_students: new Set(week.map((a) => a.user_id)).size,
    walk_trips: week.filter((a) => a.type === "trip" && a.detail.mode === "walk").length,
    byo: week.filter((a) => a.type === "byo").length,
    under_budget: underBudget(budgetRows, now),
    weeks: weeks.map((w) => {
      const a = inRange(acts, w, w + WEEK);
      return { week_start: w, low_carbon_share: lowCarbonShare(a), kg_saved: kgSaved(a, avgMealKg) };
    }),
  };
}

export function adminInsights(input: { acts: InsightAct[]; stalls: { id: string; name: string }[]; now: number }): AdminPayload {
  const { acts, stalls, now } = input;
  const weeks = weekStarts(now);
  const cur = weeks[weeks.length - 1];
  const week = inRange(acts, cur, now + 1);
  const dishes = new Map<string, { name: string; count: number; low_carbon: boolean }>();
  for (const a of verifiedMeals(week)) {
    if (!a.item_name) continue;
    const d = dishes.get(a.item_name) ?? { name: a.item_name, count: 0, low_carbon: a.low_carbon === 1 };
    d.count++;
    dishes.set(a.item_name, d);
  }
  return {
    stalls: stalls.map((s) => ({ id: s.id, name: s.name, ...stallInsights(acts, s.id, now) })),
    top_dishes: [...dishes.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 5),
    weeks: weeks.map((w) => {
      const a = inRange(acts, w, w + WEEK);
      const trips = (mode: string) => a.filter((x) => x.type === "trip" && x.detail.mode === mode).length;
      return {
        week_start: w,
        verified_meals: verifiedMeals(a).length,
        low_carbon_share: lowCarbonShare(a),
        photo_meals: a.filter((x) => x.type === "meal" && x.source === "photo").length,
        trips: { walk: trips("walk"), shuttle: trips("shuttle"), car: trips("car") },
      };
    }),
  };
}

export function stallInsights(acts: InsightAct[], stallId: string, now: number): { this_week: Stats; last_week: Stats } {
  const cur = sgWeekStart(now);
  const mine = acts.filter((a) => a.stall_id === stallId);
  return { this_week: stats(inRange(mine, cur, now + 1)), last_week: stats(inRange(mine, cur - WEEK, cur)) };
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run test/insights.test.ts`
Expected: PASS, all tests.

Check the `adminInsights` noodles figures by hand:
- this week's meals: 2 × 0.4 and 1 × 1.36
- `avg_kg` = (0.4 + 0.4 + 1.36) / 3 = 0.72
- share = 2/3, rounded to 0.67

- [ ] **Step 5: Commit**

```bash
git add src/worker/lib/insights.ts test/insights.test.ts
git commit -m "feat(insights): pure campus impact, admin and stall calculations"
```

---

### Task 2: Insights endpoints

**Files:**
- Create: `src/worker/routes/insights.ts`
- Modify: `src/worker/app.ts` (import and `app.route("/", insights);` after `progress`)
- Test: `test/insights-routes.test.ts`

**Interfaces:**
- Consumes: from Task 1, `impact`, `adminInsights`, `stallInsights`, `averageMealKg`, `weekStarts`, and the types `InsightAct`, `MenuItemKg`, `BudgetRow`. Also:
  - `safeJson(s: string | null): Record<string, unknown>` from `src/worker/acts.ts`
  - `requireRole(...roles)` from `src/worker/session.ts`
  - `fail(c, status, code, message)` from `src/worker/http.ts`
  - `sgWeekStart` from `src/worker/lib/time.ts`
- Produces:
  - `GET /api/impact` returns `ImpactPayload`
  - `GET /api/admin/insights` returns `AdminPayload`
  - `GET /api/stall/insights` returns `{ this_week: Stats; last_week: Stats }`

- [ ] **Step 1: Write the failing tests**

Create `test/insights-routes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { setup as baseSetup } from "./helpers/setup";

async function setup() {
  const ctx = await baseSetup();
  ctx.raw.exec("DELETE FROM activities WHERE id LIKE 'seed-%'"); // controlled data only
  return ctx;
}
type Ctx = Awaited<ReturnType<typeof setup>>;
let n = 0;
function meal(ctx: Ctx, user: string, stall: string, item: string, low: 0 | 1, kg: number, at = Date.now() - 60_000) {
  ctx.raw.exec(`INSERT INTO activities (id,user_id,category,type,points,verified,source,stall_id,item_id,low_carbon,kg_co2e,created_at)
    VALUES ('r${n++}','${user}','food','meal',20,1,'qr','${stall}','${item}',${low},${kg},${at})`);
}

describe("GET /api/impact", () => {
  it("works with no session and is cacheable for 30 s", async () => {
    const ctx = await setup();
    const res = await ctx.req("/api/impact");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=30");
  });

  it("is all zeros on an empty campus", async () => {
    const ctx = await setup();
    const b = (await ctx.req("/api/impact")).body;
    expect(b).toMatchObject({ kg_saved: 0, low_carbon_share: null, verified_meals: 0, active_students: 0, under_budget: null });
    expect(b.weeks).toHaveLength(8);
    expect(b.avg_meal_kg).toBeGreaterThan(0); // the seeded menu is priced
  });

  it("never exposes names, user ids or stall ids", async () => {
    const ctx = await setup();
    meal(ctx, "u-alex", "noodles", "veg-noodles", 1, 0.4);
    meal(ctx, "u-bea", "econ-rice", "econ-veg-egg", 1, 0.6);
    const b = (await ctx.req("/api/impact")).body;
    expect(b.verified_meals).toBe(2);
    expect(b.kg_saved).toBeGreaterThan(0);
    const text = JSON.stringify(b);
    for (const s of ["u-alex", "u-bea", "Alex", "Bea", "noodles", "econ-rice", "veg-noodles"]) expect(text).not.toContain(s);
  });
});

describe("GET /api/admin/insights", () => {
  it("is admin-only, including for a switched persona", async () => {
    const ctx = await setup();
    for (const as of ["u-alex", "u-seller-noodles"]) expect((await ctx.req("/api/admin/insights", { as })).status).toBe(403);
    expect((await ctx.req("/api/admin/insights")).status).toBe(401);
  });

  it("lists every stall with this week's figures and the top dishes", async () => {
    const ctx = await setup();
    meal(ctx, "u-alex", "noodles", "veg-noodles", 1, 0.4);
    meal(ctx, "u-bea", "noodles", "chicken-rice", 0, 1.36);
    const b = (await ctx.req("/api/admin/insights", { as: "u-admin" })).body;
    expect(b.stalls.map((s: any) => s.id).sort()).toEqual(["drinks", "econ-rice", "noodles"]);
    expect(b.stalls.find((s: any) => s.id === "noodles").this_week).toEqual({ meals: 2, low_carbon_share: 0.5, avg_kg: 0.88, byo: 0 });
    expect(b.top_dishes.map((d: any) => d.name).sort()).toEqual(["Chicken rice", "Vegetarian noodles with tofu"]);
    expect(b.weeks).toHaveLength(8);
  });
});

describe("GET /api/stall/insights", () => {
  it("shows a seller only their own stall, whatever the query says", async () => {
    const ctx = await setup();
    meal(ctx, "u-alex", "noodles", "veg-noodles", 1, 0.4);
    meal(ctx, "u-bea", "econ-rice", "econ-veg-egg", 1, 0.6);
    const own = (await ctx.req("/api/stall/insights?stall_id=econ-rice", { as: "u-seller-noodles" })).body;
    expect(own.this_week).toEqual({ meals: 1, low_carbon_share: 1, avg_kg: 0.4, byo: 0 });
    expect(own.last_week.meals).toBe(0);
  });

  it("is seller-only", async () => {
    const ctx = await setup();
    expect((await ctx.req("/api/stall/insights", { as: "u-alex" })).status).toBe(403);
  });
});
```

Before running, check that the stall ids in the "every stall" assertion match the seed: `grep -n "id:" seed/data.ts | grep -i stall`. Use exactly those three ids.

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run test/insights-routes.test.ts`
Expected: FAIL, with 404 `not_found` on each endpoint.

- [ ] **Step 3: Implement the routes**

Create `src/worker/routes/insights.ts`:

```ts
import { Hono } from "hono";
import { safeJson } from "../acts";
import type { AppEnv } from "../env";
import { fail } from "../http";
import { adminInsights, averageMealKg, impact, stallInsights, weekStarts, type BudgetRow, type InsightAct, type MenuItemKg } from "../lib/insights";
import { sgWeekStart } from "../lib/time";
import { requireRole } from "../session";

export const insights = new Hono<AppEnv>();
const WEEK = 7 * 86_400_000;

type Row = Omit<InsightAct, "detail"> & { detail_json: string };

/** Students' activity from `from`, optionally at one stall, with the item name for top dishes. */
async function loadInsightActs(db: D1Database, from: number, stallId: string | null = null): Promise<InsightAct[]> {
  const { results } = await db
    .prepare(
      `SELECT a.user_id, a.created_at, a.type, a.source, a.verified, a.low_carbon, a.kg_co2e, a.stall_id, a.detail_json, i.name AS item_name
       FROM activities a JOIN users u ON u.id = a.user_id LEFT JOIN items i ON i.id = a.item_id
       WHERE u.role = 'student' AND a.created_at >= ?1 AND (?2 IS NULL OR a.stall_id = ?2)`,
    )
    .bind(from, stallId)
    .all<Row>();
  return results.map(({ detail_json, ...r }) => ({ ...r, detail: safeJson(detail_json) }));
}

// Public: totals only (spec §4.1). Never add names, ids or per-stall figures here.
insights.get("/impact", async (c) => {
  const db = c.env.DB;
  const now = Date.now();
  const lastStart = sgWeekStart(now) - WEEK;
  const [acts, items, budgetRows] = await Promise.all([
    loadInsightActs(db, weekStarts(now)[0]),
    db.prepare("SELECT i.kind, i.status, i.kg_co2e, s.active AS stall_active FROM items i JOIN stalls s ON s.id = i.stall_id").all<MenuItemKg>(),
    // Budgets need each student's whole history, but only for students who logged kg last week.
    db.prepare(
      `SELECT a.user_id, u.created_at AS user_created_at, a.created_at, a.category, a.kg_co2e
       FROM activities a JOIN users u ON u.id = a.user_id
       WHERE u.role = 'student' AND a.user_id IN (SELECT DISTINCT user_id FROM activities WHERE kg_co2e IS NOT NULL AND created_at >= ?1 AND created_at < ?2)`,
    ).bind(lastStart, lastStart + WEEK).all<BudgetRow>(),
  ]);
  c.header("Cache-Control", "public, max-age=30");
  return c.json(impact({ acts, avgMealKg: averageMealKg(items.results), budgetRows: budgetRows.results, now }));
});

insights.get("/admin/insights", requireRole("admin"), async (c) => {
  const db = c.env.DB;
  const now = Date.now();
  const [acts, stalls] = await Promise.all([
    loadInsightActs(db, weekStarts(now)[0]),
    db.prepare("SELECT id, name FROM stalls ORDER BY name").all<{ id: string; name: string }>(),
  ]);
  return c.json(adminInsights({ acts, stalls: stalls.results, now }));
});

// The stall comes from the session, never from the request (spec §6).
insights.get("/stall/insights", requireRole("seller"), async (c) => {
  const stallId = c.get("user")!.stall_id;
  if (!stallId) return fail(c, 404, "no_stall", "This seller account isn't linked to a stall.");
  const now = Date.now();
  const acts = await loadInsightActs(c.env.DB, sgWeekStart(now) - WEEK, stallId);
  return c.json(stallInsights(acts, stallId, now));
});
```

In `src/worker/app.ts`, add `import { insights } from "./routes/insights";` next to the other route imports, and `app.route("/", insights);` after `app.route("/", progress);`.

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run test/insights-routes.test.ts && npx vitest run && npm run typecheck`
Expected: all PASS, and typecheck prints no errors.

Check the noodles `avg_kg` by hand: (0.4 + 1.36) / 2 = 0.88.

- [ ] **Step 5: Commit**

```bash
git add src/worker/routes/insights.ts src/worker/app.ts test/insights-routes.test.ts
git commit -m "feat(insights): public impact, admin insights and seller stall endpoints"
```

---

### Task 3: Public campus impact page

**Files:**
- Modify: `src/app/copy.ts` (add `pct`, `weekLabel`)
- Test: `test/copy.test.ts`
- Create: `src/app/screens/Impact.tsx`
- Modify: `src/app/App.tsx` (render `/impact` before the session gate)
- Modify: `src/app/styles.css` (`.impact` styles)

**Interfaces:**
- Consumes: `GET /api/impact` (`ImpactPayload` from Task 1), and `api<T>(path)` from `src/app/api.ts`.
- Produces:
  - `pct(share: number | null): string`
  - `weekLabel(ms: number): string`
  - `<Impact />`

- [ ] **Step 1: Write the failing copy tests**

Append to `test/copy.test.ts`:

```ts
import { pct, weekLabel } from "../src/app/copy";
describe("pct", () => {
  it("formats a share or a dash", () => {
    expect(pct(0.62)).toBe("62%");
    expect(pct(0)).toBe("0%");
    expect(pct(null)).toBe("—");
  });
});
describe("weekLabel", () => {
  it("names the SGT Monday", () => {
    expect(weekLabel(Date.UTC(2026, 9, 4, 16))).toBe("5 Oct");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run test/copy.test.ts`
Expected: FAIL, because `pct` is not a function.

- [ ] **Step 3: Implement the helpers**

Append to `src/app/copy.ts`:

```ts
export const pct = (share: number | null): string => (share == null ? "—" : `${Math.round(share * 100)}%`);
export const weekLabel = (ms: number): string => new Date(ms).toLocaleDateString("en-SG", { day: "numeric", month: "short", timeZone: "Asia/Singapore" });
```

Run: `npx vitest run test/copy.test.ts`. Expected: PASS.

- [ ] **Step 4: Build the page**

Create `src/app/screens/Impact.tsx`:

```tsx
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { api } from "../api";
import { pct, weekLabel } from "../copy";

type Week = { week_start: number; low_carbon_share: number | null; kg_saved: number };
type ImpactData = {
  generated_at: number; avg_meal_kg: number | null; kg_saved: number; low_carbon_share: number | null; verified_meals: number;
  active_students: number; walk_trips: number; byo: number; under_budget: { students: number; of: number; kg_below: number } | null; weeks: Week[];
};

/** Public projector page: campus totals only, refreshed every 30 s. */
export function Impact() {
  const [d, setD] = useState<ImpactData | null>(null);
  const [failed, setFailed] = useState(false);
  const [qr, setQr] = useState("");

  useEffect(() => {
    const load = () => api<ImpactData>("/impact").then((x) => { setD(x); setFailed(false); }).catch(() => setFailed(true));
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    QRCode.toDataURL(`${location.origin}/`, { margin: 1, width: 240 }).then(setQr).catch(() => {});
  }, []);

  if (!d) return <div className="impact">{failed && <p className="error">Couldn't load campus totals. Retrying…</p>}</div>;
  const updated = new Date(d.generated_at).toLocaleTimeString("en-SG", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Singapore" });

  return (
    <div className="impact">
      <div className="eyebrow">This week on campus</div>
      <h1 className="impact-headline">≈ {d.kg_saved} kg CO₂e saved</h1>
      <p className="muted">
        Estimated, vs an average campus meal{d.avg_meal_kg != null ? ` (${d.avg_meal_kg} kg)` : ""}, from {d.verified_meals} stall-verified {d.verified_meals === 1 ? "meal" : "meals"}.
      </p>
      {d.under_budget && (
        <p className="body">
          {d.under_budget.students} of {d.under_budget.of} students stayed under their personal budget last week · {d.under_budget.kg_below} kg below target
        </p>
      )}

      <div className="impact-figures">
        <div className="panel"><div className="num">{pct(d.low_carbon_share)}</div><div className="label">of verified meals were low-carbon</div></div>
        <div className="panel"><div className="num">{d.active_students}</div><div className="label">students taking part</div></div>
        <div className="panel"><div className="num">{d.walk_trips}</div><div className="label">campus trips walked</div></div>
        <div className="panel"><div className="num">{d.byo}</div><div className="label">own cups and containers</div></div>
      </div>

      <div>
        <div className="section-head">Low-carbon share, last 8 weeks</div>
        <WeekBars weeks={d.weeks} />
      </div>

      <div className="impact-foot">
        <div>
          <div className="title" style={{ fontSize: 18 }}>Campus Carbon</div>
          <div className="muted">NTU CC0006 pilot · updated {updated}</div>
        </div>
        {qr && <img src={qr} alt="QR code to open Campus Carbon" width={96} height={96} />}
      </div>
    </div>
  );
}

function WeekBars({ weeks }: { weeks: Week[] }) {
  const W = 40;
  const H = 90;
  return (
    <svg className="week-bars" viewBox={`0 0 ${weeks.length * W} ${H + 34}`} role="img" aria-label="Weekly low-carbon share">
      {weeks.map((w, i) => {
        const h = w.low_carbon_share == null ? 2 : Math.max(2, w.low_carbon_share * H);
        return (
          <g key={w.week_start} transform={`translate(${i * W + 6},0)`}>
            <rect x={0} y={H - h} width={W - 12} height={h} rx={4} fill={w.low_carbon_share == null ? "var(--line)" : "var(--accent)"} />
            <text x={(W - 12) / 2} y={H + 13} textAnchor="middle" fontSize="9" fill="var(--muted)">{weekLabel(w.week_start)}</text>
            <text x={(W - 12) / 2} y={H + 26} textAnchor="middle" fontSize="9" fill="var(--text-2)">{pct(w.low_carbon_share)}</text>
          </g>
        );
      })}
    </svg>
  );
}
```

Append to `src/app/styles.css`:

```css
/* Campus impact (public, projector) */
.impact { max-width: 1100px; margin: 0 auto; padding: calc(28px + env(safe-area-inset-top)) 20px 40px; display: flex; flex-direction: column; gap: 22px; }
.impact-headline { font-family: var(--serif); font-weight: 400; font-size: 44px; line-height: 1.08; letter-spacing: -0.02em; margin: 0; color: var(--accent); }
.impact-figures { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.week-bars { width: 100%; max-width: 640px; height: auto; display: block; }
.impact-foot { display: flex; align-items: center; justify-content: space-between; gap: 16px; border-top: 0.5px solid var(--line); padding-top: 16px; }
@media (min-width: 900px) {
  .impact { padding-top: 56px; gap: 32px; }
  .impact-headline { font-size: 80px; }
  .impact-figures { grid-template-columns: repeat(4, 1fr); }
  .impact .num { font-size: 44px; }
}
```

In `src/app/App.tsx`:
- Add `import { Impact } from "./screens/Impact";`.
- Directly after the `useEffect` that loads `/me`, and before `if (!me) return null;`, add:

```tsx
  // Public projector page: no session, no Welcome prompt.
  if (path === "/impact") return <Impact />;
```

All hooks (`usePath`, `useState`, `useCallback`, `useEffect`) are called before this line, so the hook order is unchanged.

- [ ] **Step 5: Check it in the browser**

1. Run `npm run typecheck` and `npx vitest run`. Expected: all pass.
2. `preview_start` with name `dev`. In a fresh tab with cookies cleared (or after `document.cookie` has no `uid`), open `http://localhost:5173/impact`.
3. Expected:
   - no Welcome prompt
   - the headline "≈ … kg CO₂e saved"
   - four figure panels
   - 8 bars with week labels
   - the footer QR code
4. At `resize_window` mobile (375 px): two columns, no horizontal scroll.
5. At 1280 px: four columns and an 80 px headline.
6. Empty campus (Review Focus 1): the route test already pins the zeros. In the browser, run `get_page_text` on `/impact` and confirm the words "NaN", "null" and "undefined" don't appear.

- [ ] **Step 6: Commit**

```bash
git add src/app/copy.ts test/copy.test.ts src/app/screens/Impact.tsx src/app/App.tsx src/app/styles.css
git commit -m "feat(app): public campus impact page for the projector"
```

---

### Task 4: Admin insights page and the seller's stall panel

**Files:**
- Create: `src/app/screens/AdminInsights.tsx`
- Modify: `src/app/screens/Admin.tsx` (hub button)
- Modify: `src/app/App.tsx` (route)
- Modify: `src/app/screens/Stall.tsx` (`StallWeek` panel, refreshed after a sheet closes)

**Interfaces:**
- Consumes:
  - `GET /api/admin/insights` (`AdminPayload`) and `GET /api/stall/insights` (`{ this_week: Stats; last_week: Stats }`) from Task 2
  - `pct`, `weekLabel` from Task 3
- Produces: `<AdminInsights />`, and `StallWeek({ refresh: number })` inside `Stall.tsx`.

- [ ] **Step 1: Build the admin page**

Create `src/app/screens/AdminInsights.tsx`:

```tsx
import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { pct, weekLabel } from "../copy";
import { navigate } from "../router";

type Stats = { meals: number; low_carbon_share: number | null; avg_kg: number | null; byo: number };
type Data = {
  stalls: { id: string; name: string; this_week: Stats; last_week: Stats }[];
  top_dishes: { name: string; count: number; low_carbon: boolean }[];
  weeks: { week_start: number; verified_meals: number; low_carbon_share: number | null; photo_meals: number; trips: { walk: number; shuttle: number; car: number } }[];
};

export function AdminInsights() {
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Data>("/admin/insights").then(setD).catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load insights."));
  }, []);

  return (
    <>
      <div>
        <button className="link-btn" onClick={() => navigate("/admin")}>‹ Admin</button>
        <h1 className="display" style={{ marginTop: 8 }}>Insights</h1>
        <p className="muted">Stall-verified meals only. <a href="/impact">Open the public impact page</a></p>
      </div>
      {error && <p className="error">{error}</p>}
      {d && (
        <>
          <div className="section-head">Stalls this week</div>
          <div className="list">
            {d.stalls.map((s) => (
              <div className="row" key={s.id} style={{ alignItems: "flex-start" }}>
                <span className="what">
                  {s.name}
                  <div className="muted">last week: {s.last_week.meals} meals · {pct(s.last_week.low_carbon_share)} low-carbon · {s.last_week.byo} own containers</div>
                </span>
                <span style={{ textAlign: "right" }}>
                  <div>{s.this_week.meals} meals</div>
                  <div className="muted">{pct(s.this_week.low_carbon_share)} low-carbon · {s.this_week.byo} own</div>
                </span>
              </div>
            ))}
          </div>

          <div className="section-head">Top dishes this week</div>
          {d.top_dishes.length === 0 ? (
            <p className="muted">No verified meals yet this week.</p>
          ) : (
            <div className="list">
              {d.top_dishes.map((t) => (
                <div className="row" key={t.name}>
                  <span className="what">{t.name}{t.low_carbon && <span className="muted" style={{ marginLeft: 8, color: "var(--accent)" }}>Low-carbon</span>}</span>
                  <span className="pts">{t.count}</span>
                </div>
              ))}
            </div>
          )}

          <div className="section-head">Last 8 weeks</div>
          <div className="list">
            {d.weeks.slice().reverse().map((w) => (
              <div className="row" key={w.week_start}>
                <span className="what">{weekLabel(w.week_start)}</span>
                <span className="muted" style={{ textAlign: "right" }}>
                  {w.verified_meals} meals · {pct(w.low_carbon_share)} low · {w.photo_meals} photo · trips {w.trips.walk}/{w.trips.shuttle}/{w.trips.car}
                </span>
              </div>
            ))}
          </div>
          <p className="muted">Trips are walk / shuttle / car.</p>
        </>
      )}
    </>
  );
}
```

In `src/app/screens/Admin.tsx`, inside the `isAdmin &&` panel, after the "Points and limits" button, add:

```tsx
          <button className="btn btn-secondary" onClick={() => navigate("/admin/insights")}>Insights</button>
```

In `src/app/App.tsx`:
- Add `import { AdminInsights } from "./screens/AdminInsights";`.
- Next to the other admin routes, add:

```tsx
      {path === "/admin/insights" && role === "admin" && <AdminInsights />}
```

The existing "Admins only" fallback already covers non-admins at `/admin/*`.

- [ ] **Step 2: Add the seller panel**

In `src/app/screens/Stall.tsx`, add this component at the bottom of the file:

```tsx
type WeekStats = { meals: number; low_carbon_share: number | null; avg_kg: number | null; byo: number };

function StallWeek({ refresh }: { refresh: number }) {
  const [d, setD] = useState<{ this_week: WeekStats; last_week: WeekStats } | null>(null);
  useEffect(() => {
    api<{ this_week: WeekStats; last_week: WeekStats }>("/stall/insights").then(setD).catch(() => {});
  }, [refresh]);
  if (!d) return null;
  const cell = (n: string, label: string, last: string) => (
    <div>
      <div className="num" style={{ fontSize: 24 }}>{n}</div>
      <div className="label">{label}</div>
      <div className="label">last week: {last}</div>
    </div>
  );
  return (
    <div className="panel">
      <div className="eyebrow" style={{ marginBottom: 10 }}>Your stall this week</div>
      <div className="figures">
        {cell(String(d.this_week.meals), "meals claimed", String(d.last_week.meals))}
        {cell(pct(d.this_week.low_carbon_share), "low-carbon", pct(d.last_week.low_carbon_share))}
        {cell(String(d.this_week.byo), "own containers", String(d.last_week.byo))}
      </div>
    </div>
  );
}
```

Then, in `Stall()`:
- Add `import { pct } from "../copy";` at the top.
- Add `const [refresh, setRefresh] = useState(0);` with the other state.
- In `close()`, add `setRefresh((r) => r + 1);` so the panel reloads after each sheet, claimed or not.
- Render `<StallWeek refresh={refresh} />` directly after the heading block (the `<div>` with the eyebrow and `<h1>`), before the "Own cup or container" toggle.

- [ ] **Step 3: Check it in the browser**

1. `npm run typecheck && npx vitest run`. Expected: all pass.
2. In the dev preview, as an admin (switch via `/admin`), open Admin → Insights. Expected:
   - three stall rows
   - top dishes, or the empty message
   - 8 week rows
   - the link to `/impact` works
3. Switch to the Noodles seller:
   - Expected: "Your stall this week" shows above the toggle.
   - Show a QR, and claim it as a student through the API with `fetch('/api/claim', …)` after impersonating `u-bea`, then impersonate the seller again.
   - Close the sheet. The meals count goes up by 1.
4. At mobile width (375 px): the stall panel's three figures fit without horizontal scroll.

- [ ] **Step 4: Commit**

```bash
git add src/app/screens/AdminInsights.tsx src/app/screens/Admin.tsx src/app/App.tsx src/app/screens/Stall.tsx
git commit -m "feat(app): admin insights page and the seller's stall-this-week panel"
```

---

### Task 5: Docs, deploy and smoke test

**Files:**
- Modify: `docs/demo-checklist.md`
- Modify: `docs/superpowers/specs/2026-09-29-campus-carbon-app-design.md` (§11 Screens)

- [ ] **Step 1: Update the docs**

In `docs/demo-checklist.md`, under "Stage 2–4 checks (real phones)", add:

```markdown
- [ ] Projector: open /impact on the presentation laptop (no login needed) → big "kg saved" number, 8-week bars, QR in the corner; claim a meal on a phone → within 30 s the numbers move
- [ ] Admin → Insights shows each stall this week vs last week; a seller sees "Your stall this week" above the menu
```

In the main spec, at the end of §11 Screens, add:

```markdown
- **Campus impact** (`/impact`, public) and **Insights** (`/admin/insights`; seller panel on the stall screen): see `2026-10-06-insights-and-impact-design.md`.
```

- [ ] **Step 2: Deploy and smoke test**

There is no migration in this plan. Run:

```bash
npm run deploy
curl -s https://campus-carbon.stan322.workers.dev/api/impact | head -c 300
curl -sI https://campus-carbon.stan322.workers.dev/api/impact | grep -i cache-control
```

Expected:
- JSON with `kg_saved` and 8 `weeks`
- `cache-control: public, max-age=30`

- [ ] **Step 3: Commit**

```bash
git add docs/demo-checklist.md docs/superpowers/specs/2026-09-29-campus-carbon-app-design.md
git commit -m "docs: impact and insights checklist and spec pointer"
```
