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
