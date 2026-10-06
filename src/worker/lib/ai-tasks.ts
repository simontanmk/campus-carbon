import type { Parts } from "./carbon.ts";

export const FACTOR_KEYS = ["rice", "wheat", "poultry", "pork", "beef_herd", "beef_dairy", "fish_farmed", "eggs", "tofu", "milk", "coffee", "cane_sugar", "veg"] as const;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max: number) => (typeof v === "string" && v.trim().length > 0 && v.trim().length <= max ? v.trim() : null);

export function cleanParts(raw: unknown): Parts {
  if (!isObj(raw)) return {};
  const out: Parts = {};
  for (const k of FACTOR_KEYS) {
    const g = raw[k];
    if (typeof g === "number" && Number.isFinite(g) && g > 0 && g <= 1000) out[k] = Math.round(g);
  }
  return out;
}

const PARTS_RULES = `Ingredient keys allowed (grams, dry weight for rice and noodles): ${FACTOR_KEYS.join(", ")}. "veg" covers all vegetables. Use beef_dairy for beef unless told otherwise. Omit anything else (oil, sauce, spices). Do not estimate carbon.`;

// Trip -----------------------------------------------------------------------------------------
export const TRIP_PROMPT = (places: { id: string; name: string }[]) =>
  `You map a student's sentence about a campus trip to place ids. Places: ${places.map((p) => `${p.id} = ${p.name}`).join("; ")}. ` +
  `Reply only with JSON {"from_id": string|null, "to_id": string|null}. Use null when a place is not in the list or not mentioned.`;

export const validateTrip = (ids: string[]) => (raw: unknown) => {
  if (!isObj(raw)) return null;
  const pick = (v: unknown) => (typeof v === "string" && ids.includes(v) ? v : null);
  return { from_id: pick(raw.from_id), to_id: pick(raw.to_id) };
};

export function mockTrip(text: string, places: { id: string; name: string }[]) {
  const t = text.toLowerCase();
  const hits = places
    .map((p) => {
      const names = [p.name.toLowerCase(), p.name.toLowerCase().replace(/^the /, ""), p.id.replace(/-/g, " ")];
      const at = Math.min(...names.map((n) => t.indexOf(n)).filter((i) => i >= 0));
      return { id: p.id, at };
    })
    .filter((h) => Number.isFinite(h.at))
    .sort((a, b) => a.at - b.at);
  return { from_id: hits[0]?.id ?? null, to_id: hits[1]?.id ?? null };
}

// Meal photo -----------------------------------------------------------------------------------
export const MEAL_PROMPT =
  `You identify one hawker or canteen meal in Singapore from a photo. ${PARTS_RULES} ` +
  `Reply only with JSON {"dish": string, "parts": {key: grams}, "confidence": number between 0 and 1}.`;

export function validateMeal(raw: unknown) {
  if (!isObj(raw)) return null;
  const dish = str(raw.dish, 80);
  if (!dish) return null;
  const c = typeof raw.confidence === "number" && Number.isFinite(raw.confidence) ? Math.min(1, Math.max(0, raw.confidence)) : 0.5;
  return { dish, parts: cleanParts(raw.parts), confidence: c };
}

export const mockMeal = () => ({ dish: "Vegetarian noodles with tofu", parts: { wheat: 100, veg: 100, tofu: 60 }, confidence: 0.5 });

// Menu photo -----------------------------------------------------------------------------------
export const MENU_PROMPT =
  `You read a Singapore canteen stall's menu board from a photo and list each dish or drink with a typical portion's ingredients. ${PARTS_RULES} ` +
  `Reply only with JSON {"items": [{"name": string, "kind": "meal" | "drink", "parts": {key: grams}}]}.`;

export function validateMenu(raw: unknown) {
  if (!isObj(raw) || !Array.isArray(raw.items)) return null;
  const items = raw.items
    .filter(isObj)
    .map((i) => ({ name: str(i.name, 80), kind: i.kind === "drink" ? ("drink" as const) : ("meal" as const), parts: cleanParts(i.parts) }))
    .filter((i): i is { name: string; kind: "meal" | "drink"; parts: Parts } => i.name !== null)
    .slice(0, 30);
  return items.length ? { items } : null;
}

export const mockMenu = (): { items: { name: string; kind: "meal" | "drink"; parts: Parts }[] } => ({
  items: [
    { name: "Vegetable fried rice with egg", kind: "meal" as const, parts: { rice: 80, veg: 100, eggs: 50 } },
    { name: "Chicken cutlet rice", kind: "meal" as const, parts: { rice: 80, poultry: 100, veg: 30 } },
  ],
});

// Weekly nudge ---------------------------------------------------------------------------------
export type NudgeFacts = {
  first_name: string;
  week_kg: number;
  meals_week: number;
  low_carbon_meals_week: number;
  biggest: "food" | "mobility" | "waste" | null;
  swap: { from: string; to: string; saves_kg: number } | null;
};

export const NUDGE_PROMPT =
  `You write two or three short, warm, specific sentences for a university student about their week's food and travel footprint. ` +
  `If a swap is given, end with it, including the kg it saves. Use only the numbers given; do not invent facts or numbers. ` +
  `No emoji, no exclamation marks. Reply only with JSON {"text": string}.`;

export function validateNudge(raw: unknown) {
  if (!isObj(raw)) return null;
  const text = str(raw.text, 400);
  return text ? { text } : null;
}

export function mockNudge(f: NudgeFacts): { text: string } {
  if (f.week_kg === 0 && f.meals_week === 0) return { text: "Nothing logged yet this week. Scan a stall's code after your next meal to get started." };
  const lead = `You've logged ${f.week_kg} kg CO₂e this week${f.biggest ? `, mostly from ${f.biggest}` : ""}.`;
  const swap = f.swap ? ` Swapping ${f.swap.from.toLowerCase()} for ${f.swap.to.toLowerCase()} next time saves ${f.swap.saves_kg} kg.` : "";
  return { text: lead + swap };
}
