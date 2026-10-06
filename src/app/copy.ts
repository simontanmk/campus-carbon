export function weekHeadline(w: { meals_week: number; low_carbon_meals_week: number }): string {
  const { meals_week: meals, low_carbon_meals_week: low } = w;
  if (meals === 0) return "Scan the stall's code after your next meal to start your week.";
  if (meals === 1 && low === 1) return "Your one meal this week was low-carbon.";
  if (low === meals) return `All ${meals} of your meals this week were low-carbon.`;
  const noun = meals === 1 ? "meal" : "meals";
  const verb = low === 1 || meals === 1 ? "was" : "were";
  return `${low} of your ${meals} ${noun} this week ${verb} low-carbon.`;
}

export function shortName(name: string): string {
  const m = /^Economy rice: (.+)$/.exec(name);
  return m ? `${m[1]} economy rice` : name;
}

const WORDS = ["", "", "twice", "three times", "four times", "five times", "six times", "seven times", "eight times", "nine times", "ten times"];

export function factHeadline(f: { high: { name: string; kg: number }; low: { name: string; kg: number } }): string {
  const n = Math.round(f.high.kg / f.low.kg);
  const ratio = n <= 10 ? WORDS[n] : `${n}×`;
  const low = shortName(f.low.name);
  return `${shortName(f.high.name)} has about ${ratio} the footprint of ${low.charAt(0).toLowerCase()}${low.slice(1)}.`;
}
const MODE_LABEL: Record<string, string> = { walk: "Walked", shuttle: "Shuttle", car: "Car or Grab" };

export function activityLabel(a: {
  type: string;
  item_name: string | null;
  detail: Record<string, unknown>;
  place_names: { from: string; to: string } | null;
}): string {
  if (a.item_name) return shortName(a.item_name);
  if (typeof a.detail.dish === "string" && a.detail.dish) return shortName(a.detail.dish);
  if (a.type === "trip") {
    const mode = MODE_LABEL[String(a.detail.mode)] ?? "Trip";
    return a.place_names ? `${mode}, ${a.place_names.from} to ${a.place_names.to}` : mode;
  }
  if (a.type === "steps") return `${Number(a.detail.steps).toLocaleString("en-SG")} steps`;
  if (a.type === "container_return") {
    const n = Number(a.detail.count);
    return `Returned ${n} container${n === 1 ? "" : "s"}`;
  }
  if (a.type === "byo") return "Own cup or container";
  return a.type === "drink" ? "Drink" : "Meal";
}

const CAT_LABEL = { food: "Food", mobility: "Mobility", waste: "Waste" } as const;

export function budgetLine(b: { categories: Record<"food" | "mobility" | "waste", { target: number; used: number }> }): string {
  return (Object.keys(CAT_LABEL) as (keyof typeof CAT_LABEL)[])
    .filter((k) => b.categories[k].target > 0 || b.categories[k].used > 0)
    .map((k) => {
      const c = b.categories[k];
      return c.target > 0 ? `${CAT_LABEL[k]} ${c.used} of ${c.target} kg` : `${CAT_LABEL[k]} ${c.used} kg (no first-week baseline)`;
    })
    .join(" · ");
}

/** The line under the figures while there's no budget yet. */
export function budgetNote(b: { ready: false; reason: "first_week" | "no_baseline"; ready_at: number }): string {
  if (b.reason === "no_baseline") return "No budget: your first week had nothing with a carbon footprint logged.";
  const day = new Date(b.ready_at).toLocaleDateString("en-SG", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Singapore" });
  return `Your budget starts ${day}, based on your first week.`;
}
export function ordinal(n: number): string {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}
export const PART_KEYS = ["rice", "wheat", "poultry", "pork", "beef_herd", "beef_dairy", "fish_farmed", "eggs", "tofu", "milk", "coffee", "cane_sugar", "veg"];

export function parsePartsText(text: string): { parts: Record<string, number>; unknown: string[] } {
  const parts: Record<string, number> = {};
  const unknown: string[] = [];
  for (const raw of text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)) {
    const m = /^([a-z_]+)\s+(\d+(?:\.\d+)?)\s*g?$/i.exec(raw);
    if (m && PART_KEYS.includes(m[1].toLowerCase())) parts[m[1].toLowerCase()] = Number(m[2]);
    else unknown.push(raw);
  }
  return { parts, unknown };
}

export function formatParts(parts: Record<string, number>): string {
  return Object.entries(parts).map(([k, g]) => `${k} ${g}`).join(", ");
}
