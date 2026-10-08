import { describe, expect, it } from "vitest";
import { combineFactors, COMBINED, FOOD_KEYS, OWID_ONLY, SG_ONLY } from "../seed/factors";
import { bandOf } from "../src/worker/lib/carbon";

describe("combineFactors", () => {
  it("adds land-use change to the Singapore value, rounded to 2 dp", () => {
    const c = combineFactors({ a: 3.54 }, { a: 3.5084288 }, { a: 9.87, b: 3.16 });
    expect(c.a).toEqual({ kg: 7.05, basis: "sg+luc" });
  });
  it("falls back to the OWID total when Singapore has no value", () => {
    expect(combineFactors({}, { b: 0.95 }, { b: 3.16 }).b).toEqual({ kg: 3.16, basis: "owid" });
  });
  it("needs a land-use value for every Singapore key", () => {
    expect(() => combineFactors({ a: 1 }, {}, { a: 2 })).toThrow(/land-use/);
  });
});

describe("the official tables", () => {
  it("combined values match the spec table", () => {
    const kg = Object.fromEntries(Object.entries(COMBINED).map(([k, v]) => [k, v.kg]));
    expect(kg).toEqual({
      rice: 2.55, wheat: 0.82, poultry: 7.05, pork: 15.01, beef_herd: 47.65, beef_dairy: 47.65, fish_farmed: 7.47, eggs: 3.79, veg: 0.82,
      tofu: 3.16, milk: 3.15, coffee: 28.53, cane_sugar: 3.2,
    });
  });
  it("covers every food key in all three tables", () => {
    for (const t of [COMBINED, SG_ONLY, OWID_ONLY]) expect(Object.keys(t).sort()).toEqual([...FOOD_KEYS].sort());
  });
  it("sg_only uses Singapore values with OWID fallback; owid_only is the OWID totals", () => {
    expect(SG_ONLY.poultry).toBe(3.54);
    expect(SG_ONLY.tofu).toBe(3.16);
    expect(OWID_ONLY.poultry).toBe(9.87);
    expect(OWID_ONLY.beef_dairy).toBe(33.3);
  });
});

describe("bandOf", () => {
  it.each([
    [0, "green"], [0.7, "green"], [0.71, "amber"], [1.4, "amber"], [1.41, "red"], [5, "red"],
  ])("%d kg is %s", (kg, band) => {
    expect(bandOf(kg)).toBe(band);
  });
  it("is null for an unknown kg", () => {
    expect(bandOf(null)).toBeNull();
  });
});
