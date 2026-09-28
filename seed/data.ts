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
  { key: "shuttle", kg_per_unit: null, unit: "pkm", source: "pending", note: "find sourced per-passenger-km factor; check if NTU shuttle is electric" },
  { key: "car", kg_per_unit: null, unit: "pkm", source: "pending", note: "find sourced per-passenger-km factor" },
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
