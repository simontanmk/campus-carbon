import { describe, expect, it } from "vitest";
import { computeKg, isLowCarbon } from "../src/worker/lib/carbon";

const F = {
  rice: 4.45, wheat: 1.57, poultry: 9.87, pork: 12.31, beef_herd: 99.48, beef_dairy: 33.3,
  fish_farmed: 13.63, eggs: 4.67, tofu: 3.16, milk: 3.15, coffee: 28.53, cane_sugar: 3.2, veg: 0.43,
};

describe("computeKg reproduces every spec seed value (spec §14.2–14.3)", () => {
  it.each([
    ["econ-veg-egg", { rice: 80, veg: 150, eggs: 50 }, 0.65],
    ["econ-veg-tofu", { rice: 80, veg: 150, tofu: 80 }, 0.67],
    ["veg-noodles", { wheat: 100, veg: 100, tofu: 60 }, 0.39],
    ["wanton-mee", { wheat: 100, pork: 60, veg: 30 }, 0.91],
    ["econ-chicken", { rice: 80, poultry: 80, veg: 75 }, 1.18],
    ["chicken-rice", { rice: 80, poultry: 100, veg: 30 }, 1.36],
    ["econ-pork", { rice: 80, pork: 80, veg: 75 }, 1.37],
    ["econ-fish", { rice: 80, fish_farmed: 80, veg: 75 }, 1.48],
    ["fish-soup", { rice: 80, fish_farmed: 120, veg: 80 }, 2.03],
    ["beef-hor-fun low end", { rice: 80, beef_dairy: 80, veg: 30 }, 3.03],
    ["beef-hor-fun high end", { rice: 80, beef_herd: 80, veg: 30 }, 8.33],
    ["kopi", { coffee: 10, milk: 50, cane_sugar: 10 }, 0.47],
    ["kopi-o-kosong", { coffee: 10 }, 0.29],
    ["teh", { milk: 50, cane_sugar: 10 }, 0.19],
  ])("%s", (_id, parts, kg) => {
    expect(computeKg(parts, F)).toBe(kg);
  });

  it("returns null for empty parts (not estimable)", () => {
    expect(computeKg({}, F)).toBeNull();
  });

  it("returns null when any ingredient has no factor", () => {
    expect(computeKg({ rice: 80, tea_leaves: 5 }, F)).toBeNull();
    expect(computeKg({ rice: 80 }, { rice: null })).toBeNull();
  });
});

describe("isLowCarbon (green band)", () => {
  it("is true for a meal at or under 0.7 kg, whatever it contains", () => {
    expect(isLowCarbon("meal", 0.52)).toBe(true);
    expect(isLowCarbon("meal", 0.7)).toBe(true);
  });
  it("is false for amber and red meals, unknown kg and drinks", () => {
    expect(isLowCarbon("meal", 0.71)).toBe(false);
    expect(isLowCarbon("meal", 4.04)).toBe(false);
    expect(isLowCarbon("meal", null)).toBe(false);
    expect(isLowCarbon("drink", 0.19)).toBe(false);
  });
});
