import { DEFAULT_SETTINGS } from "../src/worker/lib/settings.ts";

const OWID = "Poore & Nemecek (2018) via Our World in Data";

export const FACTORS: { key: string; kg_per_unit: number | null; unit: "kg" | "pkm"; source: string; note: string | null }[] = [
  { key: "rice", kg_per_unit: 4.45, unit: "kg", source: OWID, note: null },
  { key: "wheat", kg_per_unit: 1.57, unit: "kg", source: OWID, note: null },
  { key: "poultry", kg_per_unit: 9.87, unit: "kg", source: OWID, note: null },
  { key: "pork", kg_per_unit: 12.31, unit: "kg", source: OWID, note: null },
  { key: "beef_herd", kg_per_unit: 99.48, unit: "kg", source: OWID, note: null },
  { key: "beef_dairy", kg_per_unit: 33.3, unit: "kg", source: OWID, note: "TODO confirm on OWID grapher" },
  { key: "fish_farmed", kg_per_unit: 13.63, unit: "kg", source: OWID, note: "TODO confirm on OWID grapher" },
  { key: "eggs", kg_per_unit: 4.67, unit: "kg", source: OWID, note: null },
  { key: "tofu", kg_per_unit: 3.16, unit: "kg", source: OWID, note: null },
  { key: "milk", kg_per_unit: 3.15, unit: "kg", source: OWID, note: "proxy for condensed/evaporated milk in kopi" },
  { key: "coffee", kg_per_unit: 28.53, unit: "kg", source: OWID, note: "TODO confirm on OWID grapher" },
  { key: "cane_sugar", kg_per_unit: 3.2, unit: "kg", source: OWID, note: null },
  { key: "veg", kg_per_unit: 0.43, unit: "kg", source: OWID, note: "root vegetables, proxy for all vegetables" },
  { key: "shuttle", kg_per_unit: 0.0965, unit: "pkm", source: "UK DESNZ (2022) via Our World in Data: Bus (average)", note: "proxy; NTU shuttle fleet is being electrified, so the true value is lower" },
  { key: "car", kg_per_unit: 0.1705, unit: "pkm", source: "UK DESNZ (2022) via Our World in Data: Petrol car", note: "per km, single occupant; also used for Grab" },
];

export const STALLS = [
  { id: "econ-rice", name: "Economy Rice", canteen: "Demo Canteen", verify_method: "qr" },
  { id: "noodles", name: "Noodles & Rice Plates", canteen: "Demo Canteen", verify_method: "both" },
  { id: "drinks", name: "Drinks", canteen: "Demo Canteen", verify_method: "qr" },
] as const;

export type SeedItem = {
  id: string;
  stall_id: string;
  name: string;
  kind: "meal" | "drink";
  parts: Record<string, number>;
  kg_override?: number;
};

export const ITEMS: SeedItem[] = [
  { id: "econ-veg-egg", stall_id: "econ-rice", name: "Economy rice: 2 veg + egg", kind: "meal", parts: { rice: 80, veg: 150, eggs: 50 } },
  { id: "econ-veg-tofu", stall_id: "econ-rice", name: "Economy rice: 2 veg + tofu", kind: "meal", parts: { rice: 80, veg: 150, tofu: 80 } },
  { id: "econ-chicken", stall_id: "econ-rice", name: "Economy rice: 1 chicken + 1 veg", kind: "meal", parts: { rice: 80, poultry: 80, veg: 75 } },
  { id: "econ-pork", stall_id: "econ-rice", name: "Economy rice: 1 pork + 1 veg", kind: "meal", parts: { rice: 80, pork: 80, veg: 75 } },
  { id: "econ-fish", stall_id: "econ-rice", name: "Economy rice: 1 fish + 1 veg", kind: "meal", parts: { rice: 80, fish_farmed: 80, veg: 75 } },
  { id: "veg-noodles", stall_id: "noodles", name: "Vegetarian noodles with tofu", kind: "meal", parts: { wheat: 100, veg: 100, tofu: 60 } },
  { id: "wanton-mee", stall_id: "noodles", name: "Wanton / char siew noodles", kind: "meal", parts: { wheat: 100, pork: 60, veg: 30 } },
  { id: "chicken-rice", stall_id: "noodles", name: "Chicken rice", kind: "meal", parts: { rice: 80, poultry: 100, veg: 30 } },
  { id: "fish-soup", stall_id: "noodles", name: "Fish soup with rice", kind: "meal", parts: { rice: 80, fish_farmed: 120, veg: 80 } },
  { id: "beef-hor-fun", stall_id: "noodles", name: "Beef hor fun", kind: "meal", parts: { rice: 80, beef_dairy: 80, veg: 30 }, kg_override: 5.7 },
  { id: "kopi", stall_id: "drinks", name: "Kopi (with milk, sugar)", kind: "drink", parts: { coffee: 10, milk: 50, cane_sugar: 10 } },
  { id: "kopi-o-kosong", stall_id: "drinks", name: "Kopi-O kosong", kind: "drink", parts: { coffee: 10 } },
  { id: "teh", stall_id: "drinks", name: "Teh (with milk, sugar)", kind: "drink", parts: { milk: 50, cane_sugar: 10 } },
  { id: "teh-o-kosong", stall_id: "drinks", name: "Teh-O kosong", kind: "drink", parts: {} },
];

export const USERS = [
  { id: "u-admin", display_name: "Admin", role: "admin", stall_id: null },
  { id: "u-seller-econ", display_name: "Economy Rice seller", role: "seller", stall_id: "econ-rice" },
  { id: "u-seller-noodles", display_name: "Noodles seller", role: "seller", stall_id: "noodles" },
  { id: "u-seller-drinks", display_name: "Drinks seller", role: "seller", stall_id: "drinks" },
  { id: "u-alex", display_name: "Alex", role: "student", stall_id: null },
  { id: "u-bea", display_name: "Bea", role: "student", stall_id: null },
  { id: "u-chen", display_name: "Chen", role: "student", stall_id: null },
] as const;

export const SETTINGS = DEFAULT_SETTINGS;

/**
 * Coordinates from OpenStreetMap Nominatim, 2026-09-29.
 * Lee Wee Nam Library was dropped: its OSM footpaths are disconnected, so OSRM
 * returned 1.4 km for a 140 m walk to North Spine.
 */
export const LOCATIONS = [
  { id: "hive", name: "The Hive", lat: 1.3432338, lon: 103.6827372 },
  { id: "north-spine", name: "North Spine", lat: 1.3464737, lon: 103.680889 },
  { id: "south-spine", name: "South Spine", lat: 1.3432754, lon: 103.6812359 },
  { id: "hall-11", name: "Hall 11", lat: 1.3544176, lon: 103.6869773 },
  { id: "src", name: "Sports and Recreation Centre", lat: 1.3485623, lon: 103.6888668 },
  { id: "canteen-2", name: "Canteen 2", lat: 1.3483769, lon: 103.6854467 },
] as const;

/**
 * Demo history. day = days after the persona's created_at (0–13), hour = SGT clock hour (created_at is SGT midnight).
 * Days 0–6 form the budget baseline; days 7–13 fill the past week, so how many land in "this week" vs
 * "last week" depends on the weekday the seed runs.
 * Append only: ids are seed-<user>-<index>, and re-seeding skips existing ids, so inserting mid-array
 * would point old ids at different entries.
 * kind "meal"/"drink" reference seeded items; "trip" uses a route and mode.
 */
export type HistoryEntry =
  | { day: number; hour: number; kind: "meal" | "drink"; item: string; byo?: boolean }
  | { day: number; hour: number; kind: "trip"; from: string; to: string; mode: "walk" | "shuttle" | "car" };

const meatHeavy: HistoryEntry[] = [
  { day: 0, hour: 12, kind: "meal", item: "chicken-rice" },
  { day: 1, hour: 12, kind: "meal", item: "fish-soup" },
  { day: 1, hour: 9, kind: "trip", from: "hall-11", to: "north-spine", mode: "car" },
  { day: 2, hour: 12, kind: "meal", item: "econ-pork" },
  { day: 3, hour: 12, kind: "meal", item: "chicken-rice" },
  { day: 3, hour: 9, kind: "trip", from: "hall-11", to: "south-spine", mode: "car" },
  { day: 4, hour: 12, kind: "meal", item: "beef-hor-fun" },
  { day: 5, hour: 12, kind: "meal", item: "econ-chicken" },
  { day: 8, hour: 12, kind: "meal", item: "chicken-rice" },
  { day: 8, hour: 9, kind: "trip", from: "hall-11", to: "north-spine", mode: "shuttle" },
  { day: 9, hour: 12, kind: "meal", item: "econ-veg-egg" },
  { day: 10, hour: 12, kind: "meal", item: "fish-soup" },
  { day: 11, hour: 9, kind: "trip", from: "hall-11", to: "hive", mode: "car" },
  { day: 12, hour: 12, kind: "meal", item: "wanton-mee" },
];
const mixed: HistoryEntry[] = [
  { day: 0, hour: 12, kind: "meal", item: "econ-veg-tofu" },
  { day: 1, hour: 12, kind: "meal", item: "chicken-rice" },
  { day: 1, hour: 9, kind: "trip", from: "canteen-2", to: "north-spine", mode: "shuttle" },
  { day: 2, hour: 12, kind: "meal", item: "veg-noodles", byo: true },
  { day: 3, hour: 10, kind: "drink", item: "kopi" },
  { day: 4, hour: 12, kind: "meal", item: "econ-fish" },
  { day: 8, hour: 12, kind: "meal", item: "econ-veg-egg" },
  { day: 9, hour: 9, kind: "trip", from: "canteen-2", to: "src", mode: "walk" },
  { day: 10, hour: 12, kind: "meal", item: "wanton-mee" },
  { day: 11, hour: 12, kind: "meal", item: "veg-noodles", byo: true },
];
const lowCarbon: HistoryEntry[] = [
  { day: 0, hour: 12, kind: "meal", item: "veg-noodles", byo: true },
  { day: 1, hour: 12, kind: "meal", item: "econ-veg-egg" },
  { day: 1, hour: 9, kind: "trip", from: "hive", to: "north-spine", mode: "walk" },
  { day: 2, hour: 12, kind: "meal", item: "econ-veg-tofu" },
  { day: 3, hour: 10, kind: "drink", item: "kopi-o-kosong" },
  { day: 4, hour: 12, kind: "meal", item: "veg-noodles" },
  { day: 8, hour: 12, kind: "meal", item: "econ-veg-egg", byo: true },
  { day: 9, hour: 9, kind: "trip", from: "hive", to: "south-spine", mode: "walk" },
  { day: 10, hour: 12, kind: "meal", item: "veg-noodles" },
  { day: 11, hour: 12, kind: "meal", item: "econ-chicken" },
];

export const PERSONA_HISTORY: Record<string, HistoryEntry[]> = {
  "u-alex": meatHeavy,
  "u-bea": mixed,
  "u-chen": lowCarbon,
};
