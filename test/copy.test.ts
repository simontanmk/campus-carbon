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
import { activityLabel, budgetLine } from "../src/app/copy";

describe("activityLabel", () => {
  const base = { item_name: null, detail: {}, place_names: null };
  it("names meals by short dish name", () => {
    expect(activityLabel({ ...base, type: "meal", item_name: "Economy rice: 2 veg + egg" })).toBe("2 veg + egg economy rice");
  });
  it("describes trips with mode and places", () => {
    expect(activityLabel({ ...base, type: "trip", detail: { mode: "walk" }, place_names: { from: "The Hive", to: "Hall 11" } })).toBe("Walked, The Hive to Hall 11");
    expect(activityLabel({ ...base, type: "trip", detail: { mode: "shuttle" }, place_names: { from: "A", to: "B" } })).toBe("Shuttle, A to B");
    expect(activityLabel({ ...base, type: "trip", detail: { mode: "car" }, place_names: { from: "A", to: "B" } })).toBe("Car or Grab, A to B");
  });
  it("describes steps and returns", () => {
    expect(activityLabel({ ...base, type: "steps", detail: { steps: 5200 } })).toBe("5,200 steps");
    expect(activityLabel({ ...base, type: "container_return", detail: { count: 1 } })).toBe("Returned 1 container");
    expect(activityLabel({ ...base, type: "container_return", detail: { count: 3 } })).toBe("Returned 3 containers");
    expect(activityLabel({ ...base, type: "byo" })).toBe("Own cup or container");
  });
});

describe("budgetLine", () => {
  it("lists categories that have a target or usage, food first", () => {
    expect(budgetLine({ categories: { food: { target: 5.1, used: 1.5 }, mobility: { target: 0.85, used: 0.4 }, waste: { target: 0, used: 0 } } }))
      .toBe("Food 1.5 of 5.1 kg · Mobility 0.4 of 0.85 kg");
  });
});
import { ordinal } from "../src/app/copy";

describe("ordinal", () => {
  it.each([[1, "1st"], [2, "2nd"], [3, "3rd"], [4, "4th"], [11, "11th"], [12, "12th"], [13, "13th"], [21, "21st"], [22, "22nd"], [101, "101st"]])(
    "%i → %s",
    (n, s) => expect(ordinal(n)).toBe(s),
  );
});

describe("activityLabel for photo meals", () => {
  it("uses the dish the student confirmed", () => {
    expect(activityLabel({ type: "meal", item_name: null, detail: { dish: "Vegetarian noodles with tofu" }, place_names: null })).toBe("Vegetarian noodles with tofu");
  });
});
