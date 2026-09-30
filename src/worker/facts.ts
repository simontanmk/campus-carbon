import type { NudgeFacts } from "./lib/ai-tasks";
import { bestSwap, type MenuItem } from "./lib/swap";
import { sgWeekStart } from "./lib/time";

/** Computed numbers for the weekly nudge. The model only rephrases these. */
export async function weekFacts(db: D1Database, uid: string, now: number): Promise<NudgeFacts> {
  const weekStart = sgWeekStart(now);
  const [user, week, history, menu] = await Promise.all([
    db.prepare("SELECT display_name FROM users WHERE id = ?").bind(uid).first<{ display_name: string }>(),
    db.prepare(
      `SELECT category, COALESCE(SUM(kg_co2e),0) AS kg,
              SUM(CASE WHEN type = 'meal' THEN 1 ELSE 0 END) AS meals,
              SUM(CASE WHEN type = 'meal' AND low_carbon = 1 THEN 1 ELSE 0 END) AS low
       FROM activities WHERE user_id = ? AND created_at >= ? GROUP BY category`,
    ).bind(uid, weekStart).all<{ category: "food" | "mobility" | "waste"; kg: number; meals: number; low: number }>(),
    db.prepare("SELECT item_id FROM activities WHERE user_id = ? AND type = 'meal' AND item_id IS NOT NULL").bind(uid).all<{ item_id: string }>(),
    db.prepare("SELECT i.id, i.name, i.stall_id, i.kind, i.kg_co2e, i.low_carbon FROM items i JOIN stalls s ON s.id = i.stall_id WHERE i.status = 'live' AND s.active = 1").all<MenuItem>(),
  ]);
  const rows = week.results;
  const biggest = rows.filter((r) => r.kg > 0).sort((a, b) => b.kg - a.kg)[0]?.category ?? null;
  return {
    first_name: (user?.display_name ?? "there").split(" ")[0],
    week_kg: Math.round(rows.reduce((n, r) => n + r.kg, 0) * 100) / 100,
    meals_week: rows.reduce((n, r) => n + (r.meals ?? 0), 0),
    low_carbon_meals_week: rows.reduce((n, r) => n + (r.low ?? 0), 0),
    biggest,
    swap: bestSwap(history.results.map((h) => h.item_id), menu.results),
  };
}
