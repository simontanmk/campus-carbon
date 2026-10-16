import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, parseSettings } from "../src/worker/lib/settings";
import { byoPoints, stallClaimPoints } from "../src/worker/lib/scoring";

const s = DEFAULT_SETTINGS;

describe("stallClaimPoints (bands, spec 2026-10-16)", () => {
  it.each([
    [0.35, 20], [0.7, 20], [0.71, 10], [0.93, 10], [1.4, 10], [1.41, 0], [4.04, 0],
  ])("a %d kg meal earns %d", (kg, pts) => {
    expect(stallClaimPoints({ kind: "meal", kg_co2e: kg, points: null }, s)).toBe(pts);
  });
  it("a meal with unknown kg earns 0", () => {
    expect(stallClaimPoints({ kind: "meal", kg_co2e: null, points: null }, s)).toBe(0);
  });
  it("a drink earns 0 even when light", () => {
    expect(stallClaimPoints({ kind: "drink", kg_co2e: 0.19, points: null }, s)).toBe(0);
  });
  it("item points override wins", () => {
    expect(stallClaimPoints({ kind: "meal", kg_co2e: 4.04, points: 7 }, s)).toBe(7);
  });
  it("uses changed settings for both bands", () => {
    const t = { ...s, points_meal_low_carbon: 25, points_meal_amber: 12 };
    expect(stallClaimPoints({ kind: "meal", kg_co2e: 0.5, points: null }, t)).toBe(25);
    expect(stallClaimPoints({ kind: "meal", kg_co2e: 1, points: null }, t)).toBe(12);
  });
});

describe("byoPoints", () => {
  it("is points_byo", () => expect(byoPoints(s)).toBe(15));
});

describe("parseSettings", () => {
  it("overrides defaults with numeric values and ignores junk", () => {
    const out = parseSettings([
      { key: "points_byo", value: "12" },
      { key: "token_ttl_sec", value: "not a number" },
      { key: "unknown_key", value: "5" },
    ]);
    expect(out.points_byo).toBe(12);
    expect(out.token_ttl_sec).toBe(90);
    expect((out as any).unknown_key).toBeUndefined();
  });
});
