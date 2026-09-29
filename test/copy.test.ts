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
