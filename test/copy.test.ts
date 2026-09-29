import { describe, expect, it } from "vitest";
import { weekHeadline } from "../src/app/copy";

describe("weekHeadline", () => {
  it("invites a first scan when no meals are logged", () => {
    expect(weekHeadline({ meals_week: 0, low_carbon_meals_week: 0 })).toBe("Scan the stall's code after your next meal to start your week.");
  });
  it("celebrates a single low-carbon meal", () => {
    expect(weekHeadline({ meals_week: 1, low_carbon_meals_week: 1 })).toBe("Your one meal this week was low-carbon.");
  });
  it("celebrates all meals low-carbon", () => {
    expect(weekHeadline({ meals_week: 4, low_carbon_meals_week: 4 })).toBe("All 4 of your meals this week were low-carbon.");
  });
  it("states the share otherwise", () => {
    expect(weekHeadline({ meals_week: 6, low_carbon_meals_week: 4 })).toBe("4 of your 6 meals this week were low-carbon.");
    expect(weekHeadline({ meals_week: 1, low_carbon_meals_week: 0 })).toBe("0 of your 1 meal this week was low-carbon.");
    expect(weekHeadline({ meals_week: 2, low_carbon_meals_week: 1 })).toBe("1 of your 2 meals this week was low-carbon.");
  });
});

import { factHeadline, shortName } from "../src/app/copy";

describe("shortName", () => {
  it("turns economy rice names into plain phrases", () => {
    expect(shortName("Economy rice: 2 veg + egg")).toBe("2 veg + egg economy rice");
    expect(shortName("Fish soup with rice")).toBe("Fish soup with rice");
  });
});

describe("factHeadline", () => {
  it("states the ratio in words", () => {
    expect(factHeadline({ high: { name: "Fish soup with rice", kg: 2.03 }, low: { name: "Economy rice: 2 veg + egg", kg: 0.65 } }))
      .toBe("Fish soup with rice has about three times the footprint of 2 veg + egg economy rice.");
  });
  it("uses a multiplier sign beyond ten", () => {
    expect(factHeadline({ high: { name: "Beef hor fun", kg: 8.33 }, low: { name: "Veg noodles", kg: 0.39 } }))
      .toBe("Beef hor fun has about 21× the footprint of veg noodles.");
  });
  it("says twice for a ratio near two", () => {
    expect(factHeadline({ high: { name: "A", kg: 1.36 }, low: { name: "B", kg: 0.65 } })).toBe("A has about twice the footprint of b.");
  });
});
