import { describe, expect, it } from "vitest";
import { weekDays } from "../src/worker/lib/week";

const MON = Date.UTC(2026, 8, 27, 16, 0); // Mon 28 Sep 00:00 SGT
const H = 3_600_000;

describe("weekDays", () => {
  it("returns 7 days, Monday first, all empty with no activity", () => {
    expect(weekDays([], MON)).toEqual(["none", "none", "none", "none", "none", "none", "none"]);
  });
  it("marks a day low if any meal that day was low-carbon", () => {
    const acts = [
      { created_at: MON + 12 * H, type: "meal", low_carbon: 0 },
      { created_at: MON + 13 * H, type: "meal", low_carbon: 1 },
    ];
    expect(weekDays(acts, MON)[0]).toBe("low");
  });
  it("marks a day other when there was activity but no low-carbon meal", () => {
    const acts = [
      { created_at: MON + 24 * H + 12 * H, type: "meal", low_carbon: 0 },
      { created_at: MON + 2 * 24 * H + 9 * H, type: "drink", low_carbon: null },
    ];
    expect(weekDays(acts, MON)).toEqual(["none", "other", "other", "none", "none", "none", "none"]);
  });
  it("puts Sunday 23:59 SGT in the last slot and ignores activity outside the week", () => {
    const acts = [
      { created_at: MON + 7 * 24 * H - 60_000, type: "meal", low_carbon: 1 },
      { created_at: MON - 60_000, type: "meal", low_carbon: 1 },
      { created_at: MON + 7 * 24 * H, type: "meal", low_carbon: 1 },
    ];
    expect(weekDays(acts, MON)).toEqual(["none", "none", "none", "none", "none", "none", "low"]);
  });
});
