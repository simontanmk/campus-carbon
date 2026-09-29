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
