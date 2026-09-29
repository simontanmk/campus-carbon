import { sgWeekStart } from "./time";

const DAY = 86_400_000;
export type Category = "food" | "mobility" | "waste";
const CATS: Category[] = ["food", "mobility", "waste"];
type Line = { target: number; used: number; remaining: number; last_week: number };
export type Budget =
  | { ready: false; reason: "first_week" | "no_baseline"; ready_at: number }
  | { ready: true; overall: Line; categories: Record<Category, Line>; biggest: Category | null };

const r2 = (n: number) => Math.round(n * 100) / 100;

export function computeBudget(input: {
  createdAt: number;
  now: number;
  acts: { created_at: number; category: Category; kg_co2e: number | null }[];
}): Budget {
  const { createdAt, now, acts } = input;
  const readyAt = createdAt + 7 * DAY;
  if (now < readyAt) return { ready: false, reason: "first_week", ready_at: readyAt };

  const weekStart = sgWeekStart(now);
  const sum = (cat: Category | null, from: number, to: number) =>
    acts.reduce((n, a) => (a.kg_co2e != null && (cat === null || a.category === cat) && a.created_at >= from && a.created_at < to ? n + a.kg_co2e : n), 0);

  const baselineAll = sum(null, createdAt, readyAt);
  if (baselineAll <= 0) return { ready: false, reason: "no_baseline", ready_at: readyAt };

  const line = (cat: Category | null): Line => {
    const target = r2(sum(cat, createdAt, readyAt) * 0.85);
    const used = r2(sum(cat, weekStart, now + 1));
    return { target, used, remaining: r2(target - used), last_week: r2(sum(cat, weekStart - 7 * DAY, weekStart)) };
  };
  const categories = Object.fromEntries(CATS.map((c) => [c, line(c)])) as Record<Category, Line>;
  const biggest = CATS.reduce<Category | null>((best, c) => (categories[c].used > 0 && (best === null || categories[c].used > categories[best].used) ? c : best), null);
  return { ready: true, overall: line(null), categories, biggest };
}
