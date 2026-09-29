import { describe, expect, it } from "vitest";
import { badgeStates } from "../src/worker/lib/badges";
import type { Act } from "../src/worker/lib/missions";

const H = 3_600_000;
const DAY = 24 * H;
const MON = Date.UTC(2026, 8, 27, 16, 0);
const act = (at: number, type: string, extra: Partial<Act> = {}): Act => ({ created_at: at, type, low_carbon: null, points: 0, detail: {}, ...extra });
const earned = (acts: Act[], champ: number | null = null) =>
  Object.fromEntries(badgeStates(acts, champ).map((b) => [b.id, b.earned_at]));

describe("badgeStates (spec §7)", () => {
  it("lists five locked badges for a new student", () => {
    const b = badgeStates([], null);
    expect(b.map((x) => x.id)).toEqual(["green-starter", "low-carbon-foodie", "campus-walker", "zero-waste-hero", "carbon-champion"]);
    expect(b.every((x) => x.earned_at === null)).toBe(true);
  });

  it("Green Starter is earned at the first activity", () => {
    expect(earned([act(MON + 5 * H, "steps"), act(MON + 2 * H, "trip")])["green-starter"]).toBe(MON + 2 * H);
  });

  it("Low-Carbon Foodie at the 10th low-carbon meal", () => {
    const meals = Array.from({ length: 10 }, (_, i) => act(MON + i * H, "meal", { low_carbon: 1 }));
    expect(earned(meals.slice(0, 9))["low-carbon-foodie"]).toBeNull();
    expect(earned(meals)["low-carbon-foodie"]).toBe(MON + 9 * H);
  });

  it("Zero-Waste Hero at the 10th BYO", () => {
    const byo = Array.from({ length: 10 }, (_, i) => act(MON + i * H, "byo"));
    expect(earned(byo)["zero-waste-hero"]).toBe(MON + 9 * H);
  });

  it("Campus Walker needs 20 km of walks within one SG week", () => {
    const walk = (at: number, km: number) => act(at, "trip", { detail: { mode: "walk", distance_km: km } });
    expect(earned([walk(MON + H, 12), walk(MON + DAY, 8)])["campus-walker"]).toBe(MON + DAY);
    // 12 km last week + 12 km this week: not one week
    expect(earned([walk(MON - DAY, 12), walk(MON + H, 12)])["campus-walker"]).toBeNull();
    // car km never count
    expect(earned([act(MON + H, "trip", { detail: { mode: "car", distance_km: 30 } })])["campus-walker"]).toBeNull();
  });

  it("Carbon Champion is earned when the championship week ends", () => {
    expect(earned([], MON - 7 * DAY)["carbon-champion"]).toBe(MON);
    expect(earned([], null)["carbon-champion"]).toBeNull();
  });
});
