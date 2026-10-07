import { computeBudget } from "./budget.ts";
import { kgSaved } from "./insights.ts";
import { periodPoints, type Ranked } from "./leaderboard.ts";
import type { Act, MissionPoints } from "./missions.ts";
import { streak } from "./streak.ts";
import { sgWeekStart } from "./time.ts";

const WEEK = 7 * 86_400_000;

export type RecapWeek = "last" | "this";
export type RecapAct = Act & { category: "food" | "mobility" | "waste"; kg_co2e: number | null };
export type RecapPayload = {
  week: RecapWeek; week_start: number; week_end: number; first_name: string; empty: boolean; points: number;
  verified_meals: number; low_carbon_meals: number; kg_saved: number; walk_trips: number; byo: number; streak: number;
  rank: { rank: number; of: number } | null; under_budget_kg: number | null;
};

/** [from, to) of the recap week; week_end is what the card shows as the week's end. */
export function recapRange(week: RecapWeek, now: number): { from: number; to: number; week_end: number } {
  const cur = sgWeekStart(now);
  return week === "last" ? { from: cur - WEEK, to: cur, week_end: cur } : { from: cur, to: now + 1, week_end: now };
}

export function buildRecap(input: {
  week: RecapWeek; now: number; userId: string; displayName: string; createdAt: number;
  acts: RecapAct[]; avgMealKg: number | null; ranked: Ranked[]; points?: MissionPoints;
}): RecapPayload {
  const { week, now, userId, displayName, createdAt, acts, avgMealKg, ranked, points } = input;
  const { from, to, week_end } = recapRange(week, now);
  const inWeek = acts.filter((a) => a.created_at >= from && a.created_at < to);
  const meals = inWeek.filter((a) => a.type === "meal" && a.verified === 1);
  const mine = ranked.find((r) => r.user_id === userId);
  return {
    week,
    week_start: from,
    week_end,
    first_name: displayName.trim().split(/\s+/)[0] ?? "",
    empty: inWeek.length === 0,
    points: periodPoints(acts, from, to, points),
    verified_meals: meals.length,
    low_carbon_meals: meals.filter((a) => a.low_carbon === 1).length,
    kg_saved: kgSaved(inWeek, avgMealKg),
    walk_trips: inWeek.filter((a) => a.type === "trip" && a.detail.mode === "walk").length,
    byo: inWeek.filter((a) => a.type === "byo").length,
    streak: streak(acts.map((a) => a.created_at), week === "last" ? to - 1 : now),
    rank: mine ? { rank: mine.rank, of: ranked.length } : null,
    under_budget_kg: week === "last" ? underBy(createdAt, from, inWeek, acts, now) : null,
  };
}

/** Last week vs the student's budget; only when it was a full post-baseline week with kg logged, and only if under. */
function underBy(createdAt: number, from: number, inWeek: RecapAct[], acts: RecapAct[], now: number): number | null {
  if (createdAt + WEEK > from) return null;
  // Needs some footprint: a week of only walks (0 kg) would read as "under" by the whole target.
  if (!(inWeek.reduce((n, a) => n + (a.kg_co2e ?? 0), 0) > 0)) return null;
  const b = computeBudget({ createdAt, now, acts });
  if (!b.ready) return null;
  const d = Math.round((b.overall.target - b.overall.last_week) * 10) / 10;
  return d > 0 ? d : null;
}
