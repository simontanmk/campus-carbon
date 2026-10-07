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

describe("under_budget_kg needs a footprint", () => {
  it("is null for a week of only walks (0 kg)", () => {
    const created = MON - 21 * DAY;
    const acts = [
      act({ created_at: created + H, kg_co2e: 10, low_carbon: 0 }),
      act({ type: "trip", category: "mobility", low_carbon: null, kg_co2e: 0, points: 10, verified: 0, detail: { mode: "walk" } }),
    ];
    expect(buildRecap({ ...base, createdAt: created, week: "last", acts }).under_budget_kg).toBeNull();
  });
});
