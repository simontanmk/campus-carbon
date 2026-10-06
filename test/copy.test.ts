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
  it("doesn't call a category with no baseline over budget", () => {
    expect(budgetLine({ categories: { food: { target: 5.1, used: 1.5 }, mobility: { target: 0, used: 0.4 }, waste: { target: 0, used: 0 } } }))
      .toBe("Food 1.5 of 5.1 kg · Mobility 0.4 kg (no first-week baseline)");
  });
});

import { budgetNote } from "../src/app/copy";
describe("budgetNote", () => {
  it("explains a missing budget when the first week had no footprint", () => {
    expect(budgetNote({ ready: false, reason: "no_baseline", ready_at: 0 })).toBe("No budget: your first week had nothing with a carbon footprint logged.");
  });
  it("gives the start date during the first week", () => {
    expect(budgetNote({ ready: false, reason: "first_week", ready_at: Date.UTC(2026, 9, 6, 4) })).toBe("Your budget starts Tuesday, 6 October, based on your first week.");
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
import { formatParts, parsePartsText } from "../src/app/copy";

describe("ingredient text", () => {
  it("parses 'key grams' pairs separated by commas or new lines", () => {
    expect(parsePartsText("rice 80, veg 150\neggs 50g")).toEqual({ parts: { rice: 80, veg: 150, eggs: 50 }, unknown: [] });
  });
  it("reports unknown or malformed entries", () => {
    expect(parsePartsText("rice 80, chilli 5, tofu")).toEqual({ parts: { rice: 80 }, unknown: ["chilli 5", "tofu"] });
  });
  it("formats parts back to text", () => {
    expect(formatParts({ rice: 80, veg: 150 })).toBe("rice 80, veg 150");
  });
});
import { pct, weekLabel } from "../src/app/copy";
describe("pct", () => {
  it("formats a share or a dash", () => {
    expect(pct(0.62)).toBe("62%");
    expect(pct(0)).toBe("0%");
    expect(pct(null)).toBe("—");
  });
});
describe("weekLabel", () => {
  it("names the SGT Monday", () => {
    expect(weekLabel(Date.UTC(2026, 9, 4, 16))).toBe("5 Oct");
  });
});
import { recapLines, type RecapData } from "../src/app/copy";
describe("recapLines", () => {
  const MON = Date.UTC(2026, 9, 4, 16); // 5 Oct 2026 00:00 SGT
  const d: RecapData = {
    week: "last", week_start: MON, week_end: MON + 7 * 86_400_000, first_name: "Simon", empty: false, points: 185,
    verified_meals: 6, low_carbon_meals: 4, kg_saved: 2.3, walk_trips: 1, byo: 2, streak: 4, rank: { rank: 3, of: 24 }, under_budget_kg: 2.1,
  };
  it("lays out last week with dates, figures and every earned line", () => {
    const l = recapLines(d);
    expect(l.title).toBe("Simon · 5 Oct – 11 Oct");
    expect(l.headline).toBe("185");
    expect(l.headlineLabel).toBe("points last week");
    expect(l.panels).toEqual([
      { value: "4 of 6", label: "low-carbon meals" },
      { value: "≈ 2.3 kg", label: "CO₂e saved (est.)" },
      { value: "1", label: "walk" },
      { value: "2", label: "own cups and containers" },
    ]);
    expect(l.extras).toEqual(["4-day streak", "#3 of 24 last week", "2.1 kg under my budget"]);
  });
  it("this week says so far and currently, and drops lines that don't apply", () => {
    const l = recapLines({ ...d, week: "this", streak: 1, rank: null, under_budget_kg: null, walk_trips: 3 });
    expect(l.title).toBe("Simon · this week so far");
    expect(l.headlineLabel).toBe("points so far");
    expect(l.panels[2]).toEqual({ value: "3", label: "walks" });
    expect(l.extras).toEqual([]);
    expect(recapLines({ ...d, week: "this" }).extras).toContain("currently #3 of 24");
  });
});
