import { Hono } from "hono";
import type { AppEnv } from "../env";
import { loadSettings } from "../db";
import { bestSwap, type MenuItem } from "../lib/swap";
import { sgWeekStart } from "../lib/time";
import { weekDays } from "../lib/week";
import { requireRole } from "../session";

export const me = new Hono<AppEnv>();

me.get("/me/summary", requireRole("student"), async (c) => {
  const db = c.env.DB;
  const uid = c.get("user")!.id;
  const weekStart = sgWeekStart(Date.now());
  const totals = await db
    .prepare(
      `SELECT COALESCE(SUM(points),0) AS total,
              COALESCE(SUM(CASE WHEN created_at >= ?1 THEN points ELSE 0 END),0) AS week,
              COALESCE(SUM(CASE WHEN created_at >= ?1 AND type = 'meal' THEN 1 ELSE 0 END),0) AS meals_week,
              COALESCE(SUM(CASE WHEN created_at >= ?1 AND type = 'meal' AND low_carbon = 1 THEN 1 ELSE 0 END),0) AS low_week,
              COALESCE(SUM(CASE WHEN created_at >= ?1 THEN kg_co2e ELSE 0 END),0) AS kg_week
       FROM activities WHERE user_id = ?2`,
    )
    .bind(weekStart, uid)
    .first<{ total: number; week: number; meals_week: number; low_week: number; kg_week: number }>();
  const { results } = await db
    .prepare(
      `SELECT a.type, a.points, a.kg_co2e, a.low_carbon, a.verified, a.created_at, i.name AS item_name
       FROM activities a LEFT JOIN items i ON i.id = a.item_id
       WHERE a.user_id = ? ORDER BY a.created_at DESC LIMIT 20`,
    )
    .bind(uid)
    .all<{ type: string; points: number; kg_co2e: number | null; low_carbon: number | null; verified: number; created_at: number; item_name: string | null }>();
  const [weekActs, history, menuRes, settings] = await Promise.all([
    db.prepare("SELECT created_at, type, low_carbon FROM activities WHERE user_id = ? AND created_at >= ?").bind(uid, weekStart)
      .all<{ created_at: number; type: string; low_carbon: number | null }>(),
    db.prepare("SELECT item_id FROM activities WHERE user_id = ? AND type = 'meal' AND item_id IS NOT NULL").bind(uid)
      .all<{ item_id: string }>(),
    db.prepare("SELECT i.id, i.name, i.stall_id, i.kind, i.kg_co2e, i.low_carbon, s.name AS stall_name FROM items i JOIN stalls s ON s.id = i.stall_id WHERE i.status = 'live' AND s.active = 1")
      .all<MenuItem & { stall_name: string }>(),
    loadSettings(db),
  ]);
  const menu = menuRes.results;
  const find = (id: string) => menu.find((m) => m.id === id);
  const high = find("fish-soup");
  const low = find("econ-veg-egg");
  const lightest = menu
    .filter((m) => m.kind === "meal" && m.low_carbon === 1 && m.kg_co2e != null)
    .sort((a, b) => a.kg_co2e! - b.kg_co2e!)[0];

  return c.json({
    days: weekDays(weekActs.results, weekStart),
    swap: bestSwap(history.results.map((h) => h.item_id), menu),
    fact: high && low && high.kg_co2e != null && low.kg_co2e != null
      ? { high: { name: high.name, kg: high.kg_co2e }, low: { name: low.name, kg: low.kg_co2e } }
      : null,
    featured: lightest
      ? { name: lightest.name, stall_name: lightest.stall_name, kg_co2e: lightest.kg_co2e, points: settings.points_meal_low_carbon }
      : null,
    points_total: totals?.total ?? 0,
    points_week: totals?.week ?? 0,
    meals_week: totals?.meals_week ?? 0,
    low_carbon_meals_week: totals?.low_week ?? 0,
    kg_week: Math.round((totals?.kg_week ?? 0) * 100) / 100,
    recent: results.map((r) => ({
      ...r,
      low_carbon: r.low_carbon == null ? null : r.low_carbon === 1,
      verified: r.verified === 1,
    })),
  });
});
