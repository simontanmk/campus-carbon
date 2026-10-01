import { describe, expect, it } from "vitest";
import {
  cleanParts, mockMeal, mockMenu, mockNudge, mockTrip, validateMeal, validateMenu, validateNudge, validateTrip,
} from "../src/worker/lib/ai-tasks";

const places = [
  { id: "hive", name: "The Hive" },
  { id: "hall-11", name: "Hall 11" },
  { id: "north-spine", name: "North Spine" },
  { id: "src", name: "Sports and Recreation Centre" },
];

describe("cleanParts", () => {
  it("keeps only factor keys with 0 < grams <= 1000, rounded", () => {
    expect(cleanParts({ rice: 80.4, veg: 150, chilli: 10, pork: -5, tofu: 5000, eggs: "50", wheat: 0 })).toEqual({ rice: 80, veg: 150 });
  });
  it("returns {} for non-objects", () => {
    expect(cleanParts(null)).toEqual({});
    expect(cleanParts([1, 2])).toEqual({});
    expect(cleanParts("rice")).toEqual({});
  });
});

describe("trip", () => {
  const v = validateTrip(places.map((p) => p.id));
  it("accepts known ids", () => expect(v({ from_id: "hive", to_id: "hall-11" })).toEqual({ from_id: "hive", to_id: "hall-11" }));
  it("turns unknown ids into null", () => expect(v({ from_id: "hive", to_id: "mars" })).toEqual({ from_id: "hive", to_id: null }));
  it("rejects a non-object", () => expect(v("hive")).toBeNull());
  it("mock matches names and ids in the order they appear", () => {
    expect(mockTrip("from hall 11 to the hive please", places)).toEqual({ from_id: "hall-11", to_id: "hive" });
    expect(mockTrip("Hive → North Spine", places)).toEqual({ from_id: "hive", to_id: "north-spine" });
    expect(mockTrip("to the sports and recreation centre", places)).toEqual({ from_id: "src", to_id: null });
    expect(mockTrip("going somewhere", places)).toEqual({ from_id: null, to_id: null });
  });
});

describe("meal", () => {
  it("accepts a dish with cleaned parts and clamps confidence", () => {
    expect(validateMeal({ dish: " Veg noodles ", parts: { wheat: 100, chilli: 3 }, confidence: 1.4 })).toEqual({ dish: "Veg noodles", parts: { wheat: 100 }, confidence: 1 });
  });
  it("rejects a missing or empty dish", () => {
    expect(validateMeal({ dish: "", parts: {} })).toBeNull();
    expect(validateMeal({ parts: { rice: 80 } })).toBeNull();
  });
  it("mock is a valid meal", () => expect(validateMeal(mockMeal())).not.toBeNull());
});

describe("menu", () => {
  it("accepts up to 30 items, defaulting kind to meal and dropping nameless ones", () => {
    const r = validateMenu({ items: [{ name: "Kopi", kind: "drink", parts: { coffee: 10, milk: 50 } }, { name: "Fried rice", parts: { rice: 80 } }, { parts: {} }] });
    expect(r).toEqual({ items: [{ name: "Kopi", kind: "drink", parts: { coffee: 10, milk: 50 } }, { name: "Fried rice", kind: "meal", parts: { rice: 80 } }] });
  });
  it("rejects no items", () => {
    expect(validateMenu({ items: [] })).toBeNull();
    expect(validateMenu({})).toBeNull();
  });
  it("caps at 30 items", () => {
    const items = Array.from({ length: 40 }, (_, i) => ({ name: `Dish ${i}`, parts: { rice: 80 } }));
    expect(validateMenu({ items })!.items).toHaveLength(30);
  });
  it("mock is a valid menu", () => expect(validateMenu(mockMenu())).not.toBeNull());
});

describe("nudge", () => {
  it("accepts 1–400 characters of text", () => {
    expect(validateNudge({ text: "  Nice week.  " })).toEqual({ text: "Nice week." });
    expect(validateNudge({ text: "" })).toBeNull();
    expect(validateNudge({ text: "x".repeat(401) })).toBeNull();
  });
  it("mock mentions the biggest source and the swap", () => {
    const t = mockNudge({ first_name: "Alex", week_kg: 4.2, meals_week: 3, low_carbon_meals_week: 1, biggest: "food", swap: { from: "Chicken rice", to: "Vegetarian noodles with tofu", saves_kg: 0.97 } }).text;
    expect(t).toContain("4.2 kg");
    expect(t).toContain("food");
    expect(t).toContain("0.97 kg");
  });
  it("prompt asks for 2–3 sentences and to mention the swap", async () => {
    const { NUDGE_PROMPT } = await import("../src/worker/lib/ai-tasks");
    expect(NUDGE_PROMPT).toMatch(/two or three/i);
    expect(NUDGE_PROMPT).toMatch(/swap/i);
  });

  it("mock copes with an empty week", () => {
    expect(mockNudge({ first_name: "Bea", week_kg: 0, meals_week: 0, low_carbon_meals_week: 0, biggest: null, swap: null }).text.length).toBeGreaterThan(10);
  });
});
