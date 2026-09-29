import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, parseSettings } from "../src/worker/lib/settings";
import { byoPoints, stallClaimPoints } from "../src/worker/lib/scoring";

const s = DEFAULT_SETTINGS;

describe("stallClaimPoints (spec §7)", () => {
  it("low-carbon meal earns points_meal_low_carbon", () => {
    expect(stallClaimPoints({ kind: "meal", low_carbon: true, points: null }, s)).toBe(20);
  });
  it("other meal earns 0", () => {
    expect(stallClaimPoints({ kind: "meal", low_carbon: false, points: null }, s)).toBe(0);
  });
  it("drink earns 0 even if flagged low-carbon", () => {
    expect(stallClaimPoints({ kind: "drink", low_carbon: true, points: null }, s)).toBe(0);
  });
  it("item points override wins", () => {
    expect(stallClaimPoints({ kind: "meal", low_carbon: false, points: 7 }, s)).toBe(7);
  });
  it("uses changed settings", () => {
    expect(stallClaimPoints({ kind: "meal", low_carbon: true, points: null }, { ...s, points_meal_low_carbon: 25 })).toBe(25);
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
