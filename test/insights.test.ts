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
