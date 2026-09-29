import { describe, expect, it } from "vitest";
import { bestSwap } from "../src/worker/lib/swap";

const menu = [
  { id: "econ-veg-egg", name: "Economy rice: 2 veg + egg", stall_id: "econ-rice", kind: "meal", kg_co2e: 0.65, low_carbon: 1 },
  { id: "econ-veg-tofu", name: "Economy rice: 2 veg + tofu", stall_id: "econ-rice", kind: "meal", kg_co2e: 0.67, low_carbon: 1 },
  { id: "econ-chicken", name: "Economy rice: 1 chicken + 1 veg", stall_id: "econ-rice", kind: "meal", kg_co2e: 1.18, low_carbon: 0 },
  { id: "veg-noodles", name: "Vegetarian noodles with tofu", stall_id: "noodles", kind: "meal", kg_co2e: 0.39, low_carbon: 1 },
  { id: "chicken-rice", name: "Chicken rice", stall_id: "noodles", kind: "meal", kg_co2e: 1.36, low_carbon: 0 },
  { id: "fish-soup", name: "Fish soup with rice", stall_id: "noodles", kind: "meal", kg_co2e: 2.03, low_carbon: 0 },
  { id: "kopi", name: "Kopi", stall_id: "drinks", kind: "drink", kg_co2e: 0.47, low_carbon: 0 },
];

describe("bestSwap", () => {
  it("is null with no higher-carbon meals in history", () => {
    expect(bestSwap([], menu)).toBeNull();
    expect(bestSwap(["econ-veg-egg"], menu)).toBeNull();
  });
  it("swaps the most frequent higher-carbon meal for the lightest low-carbon meal at the same stall", () => {
    expect(bestSwap(["chicken-rice", "chicken-rice", "fish-soup"], menu)).toEqual({
      from: "Chicken rice", to: "Vegetarian noodles with tofu", saves_kg: 0.97,
    });
  });
  it("breaks frequency ties by the larger saving", () => {
    expect(bestSwap(["econ-chicken", "fish-soup"], menu)).toEqual({
      from: "Fish soup with rice", to: "Vegetarian noodles with tofu", saves_kg: 1.64,
    });
  });
  it("falls back to the lightest low-carbon meal anywhere when the stall has none", () => {
    const m = [...menu, { id: "beef", name: "Beef hor fun", stall_id: "beefstall", kind: "meal", kind: "meal", kg_co2e: 5.7, low_carbon: 0 }];
    expect(bestSwap(["beef"], m)).toEqual({ from: "Beef hor fun", to: "Vegetarian noodles with tofu", saves_kg: 5.31 });
  });
  it("ignores drinks and items missing from the menu", () => {
    expect(bestSwap(["kopi", "gone"], menu)).toBeNull();
  });
});
