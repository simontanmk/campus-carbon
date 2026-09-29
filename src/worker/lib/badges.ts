import type { Act } from "./missions";
import { sgWeekStart } from "./time";

const DAY = 86_400_000;

export const BADGES = [
  { id: "green-starter", name: "Green Starter", rule: "Log your first action" },
  { id: "low-carbon-foodie", name: "Low-Carbon Foodie", rule: "Eat 10 low-carbon meals" },
  { id: "campus-walker", name: "Campus Walker", rule: "Walk 20 km of campus trips in one week" },
  { id: "zero-waste-hero", name: "Zero-Waste Hero", rule: "Bring your own cup or container 10 times" },
  { id: "carbon-champion", name: "Carbon Champion", rule: "Top last week's leaderboard" },
];

export type BadgeState = { id: string; name: string; rule: string; earned_at: number | null };

function nth(acts: Act[], pred: (a: Act) => boolean, n: number): number | null {
  let seen = 0;
  for (const a of acts) if (pred(a) && ++seen === n) return a.created_at;
  return null;
}

function walkerAt(acts: Act[]): number | null {
  const km = new Map<number, number>();
  for (const a of acts) {
    if (a.type !== "trip" || a.detail.mode !== "walk") continue;
    const w = sgWeekStart(a.created_at);
    const total = (km.get(w) ?? 0) + (Number(a.detail.distance_km) || 0);
    km.set(w, total);
    if (total >= 20) return a.created_at;
  }
  return null;
}

export function badgeStates(acts: Act[], championOfWeek: number | null): BadgeState[] {
  const sorted = [...acts].sort((a, b) => a.created_at - b.created_at);
  const at: Record<string, number | null> = {
    "green-starter": sorted[0]?.created_at ?? null,
    "low-carbon-foodie": nth(sorted, (a) => a.type === "meal" && a.low_carbon === 1, 10),
    "campus-walker": walkerAt(sorted),
    "zero-waste-hero": nth(sorted, (a) => a.type === "byo", 10),
    "carbon-champion": championOfWeek == null ? null : championOfWeek + 7 * DAY,
  };
  return BADGES.map((b) => ({ ...b, earned_at: at[b.id] }));
}
