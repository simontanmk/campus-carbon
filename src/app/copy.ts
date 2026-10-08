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
export const pct = (share: number | null): string => (share == null ? "—" : `${Math.round(share * 100)}%`);
export const weekLabel = (ms: number): string => new Date(ms).toLocaleDateString("en-SG", { day: "numeric", month: "short", timeZone: "Asia/Singapore" });

export type RecapData = {
  week: "last" | "this"; week_start: number; week_end: number; first_name: string; empty: boolean; points: number;
  verified_meals: number; low_carbon_meals: number; kg_saved: number; walk_trips: number; byo: number; streak: number;
  rank: { rank: number; of: number } | null; under_budget_kg: number | null;
};

/** Everything the recap image says, decided here so it can be tested without a canvas. */
export function recapLines(d: RecapData) {
  const last = d.week === "last";
  const range = last ? `${weekLabel(d.week_start)} – ${weekLabel(d.week_end - 1)}` : "this week so far";
  return {
    eyebrow: "CAMPUS CARBON",
    title: `${d.first_name} · ${range}`,
    headline: String(d.points),
    headlineLabel: last ? "points last week" : "points so far",
    panels: [
      { value: `${d.low_carbon_meals} of ${d.verified_meals}`, label: "low-carbon meals" },
      { value: `≈ ${d.kg_saved} kg`, label: "CO₂e saved (est.)" },
      { value: String(d.walk_trips), label: d.walk_trips === 1 ? "walk" : "walks" },
      { value: String(d.byo), label: "own cups and containers" },
    ],
    extras: [
      d.streak >= 2 ? `${d.streak}-day streak` : null,
      d.rank ? (last ? `#${d.rank.rank} of ${d.rank.of} last week` : `currently #${d.rank.rank} of ${d.rank.of}`) : null,
      last && d.under_budget_kg != null ? `${d.under_budget_kg} kg under my budget` : null,
    ].filter((x): x is string => x !== null),
    footnote: "kg saved is an estimate vs an average campus meal",
  };
}

export const showCode = (code: string): string => `${code.slice(0, 3)}-${code.slice(3)}`;
export const mmss = (seconds: number): string => {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
/** Why Redeem is disabled, or null when it isn't. */
export function redeemBlock(r: { cost: number; left_this_week: number | null }, balance: number, hasActive: boolean): string | null {
  if (hasActive) return "Use your current code first";
  if (r.left_this_week === 0) return "All gone this week";
  if (balance < r.cost) return `Need ${r.cost - balance} more`;
  return null;
}

const DAY_MS = 86_400_000;
const SG = 8 * 3_600_000;
/** "5 Oct – 11 Oct": last week's SGT Monday to Sunday, for the Today recap entry. */
export function lastWeekRange(now: number): string {
  const day = Math.floor((now + SG) / DAY_MS) * DAY_MS - SG;
  const monday = day - ((new Date(day + SG).getUTCDay() + 6) % 7) * DAY_MS;
  return `${weekLabel(monday - 7 * DAY_MS)} – ${weekLabel(monday - DAY_MS)}`;
}
export const recapEmpty = (week: "last" | "this"): string => (week === "this" ? "Nothing logged yet this week." : "Nothing logged that week.");

/** The swap line repeats the nudge when the nudge already names the suggested dish; show it only when it adds something. */
export function showSwapLine(nudge: string | null, swap: { to: string } | null): boolean {
  if (!swap) return false;
  return !nudge || !nudge.toLowerCase().includes(shortName(swap.to).toLowerCase());
}

/** Toast after a receipt-backed container return. */
export const receiptToast = (containers: number, points: string) => `${containers} container${containers === 1 ? "" : "s"} returned ${points}`;

/** How an activity was backed, for the Recent list: nothing for seller-verified claims. */
export const evidenceTag = (a: { verified: boolean; source?: string }) => (a.verified ? null : a.source === "receipt" ? "refund receipt" : "self-reported");
