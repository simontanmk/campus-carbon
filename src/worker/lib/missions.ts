import { sgDayStart, sgWeekStart } from "./time.ts";

export type Act = { created_at: number; type: string; low_carbon: number | null; points: number; verified: number; detail: Record<string, unknown> };

/** Food missions and badges count only stall-verified meals, so self-reported photos can't unlock them (spec §3). */
export const isVerifiedLowCarbonMeal = (a: Act) => a.type === "meal" && a.low_carbon === 1 && a.verified === 1;
type Metric = "low_carbon_meals" | "steps" | "byo" | "walk_trips" | "all_weekly";
type Period = "daily" | "weekly";
export type Mission = { id: string; name: string; category: string; metric: Metric; target: number; points: number; period: Period };
export type MissionState = Mission & { progress: number; completed: boolean };
/** Admin overrides of mission rewards by mission id: fixed, or per SGT week (a change applies from the week it was made). */
export type MissionPoints = Record<string, number> | ((weekStart: number) => Record<string, number>);
const withPoints = (p: MissionPoints | undefined, weekStart: number) => {
  const o = typeof p === "function" ? p(weekStart) : p;
  return o ? MISSIONS.map((m) => (o[m.id] != null ? { ...m, points: o[m.id] } : m)) : MISSIONS;
};

export const MISSIONS: Mission[] = [
  { id: "daily-low-meal", name: "Eat one low-carbon meal today", category: "food", metric: "low_carbon_meals", target: 1, points: 20, period: "daily" },
  { id: "daily-walk", name: "Walk one campus trip today", category: "mobility", metric: "walk_trips", target: 1, points: 20, period: "daily" },
  { id: "weekly-low-meals", name: "Eat 2 low-carbon meals this week", category: "food", metric: "low_carbon_meals", target: 2, points: 100, period: "weekly" },
  { id: "weekly-steps", name: "Walk 5,000 steps this week", category: "mobility", metric: "steps", target: 5000, points: 100, period: "weekly" },
  { id: "weekly-byo", name: "Bring your own cup or container once", category: "waste", metric: "byo", target: 1, points: 80, period: "weekly" },
  { id: "weekly-all", name: "Complete every weekly mission", category: "all", metric: "all_weekly", target: 3, points: 50, period: "weekly" },
];

function metricValue(metric: Metric, acts: Act[]): number {
  switch (metric) {
    case "low_carbon_meals":
      return acts.filter(isVerifiedLowCarbonMeal).length;
    case "steps":
      return acts.reduce((n, a) => (a.type === "steps" ? n + (Number(a.detail.steps) || 0) : n), 0);
    case "byo":
      return acts.filter((a) => a.type === "byo").length;
    case "walk_trips":
      return acts.filter((a) => a.type === "trip" && a.detail.mode === "walk").length;
    case "all_weekly":
      return 0; // derived from the other weekly missions in statesFor
  }
}

/** Mission states for one period, given only that period's activity. */
function statesFor(period: Period, acts: Act[], missions: Mission[] = MISSIONS): MissionState[] {
  const list = missions.filter((m) => m.period === period);
  const base = list
    .filter((m) => m.metric !== "all_weekly")
    .map((m) => {
      const v = metricValue(m.metric, acts);
      return { ...m, progress: Math.min(v, m.target), completed: v >= m.target };
    });
  const done = base.filter((b) => b.completed).length;
  const all = list
    .filter((m) => m.metric === "all_weekly")
    .map((m) => ({ ...m, target: base.length, progress: done, completed: base.length > 0 && done === base.length }));
  return [...base, ...all];
}

export function currentMissions(acts: Act[], now: number, points?: MissionPoints): { daily: MissionState[]; weekly: MissionState[] } {
  const day = sgDayStart(now);
  const week = sgWeekStart(now);
  const list = withPoints(points, week);
  return {
    daily: statesFor("daily", acts.filter((a) => a.created_at >= day && a.created_at <= now), list),
    weekly: statesFor("weekly", acts.filter((a) => a.created_at >= week && a.created_at <= now), list),
  };
}

/** Bonus points for every daily and weekly period that has activity in [from, to). */
export function missionPoints(acts: Act[], from: number, to: number, points?: MissionPoints): number {
  const inRange = acts.filter((a) => a.created_at >= from && a.created_at < to);
  let total = 0;
  for (const [period, keyOf] of [["daily", sgDayStart], ["weekly", sgWeekStart]] as const) {
    const groups = new Map<number, Act[]>();
    for (const a of inRange) {
      const k = keyOf(a.created_at);
      const g = groups.get(k);
      if (g) g.push(a);
      else groups.set(k, [a]);
    }
    for (const [k, g] of groups) {
      total += statesFor(period, g, withPoints(points, sgWeekStart(k))).reduce((n, s) => (s.completed ? n + s.points : n), 0);
    }
  }
  return total;
}
