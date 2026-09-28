import { Hono } from "hono";
import type { AppEnv } from "../env";
import { sgWeekStart } from "../lib/time";
import { requireRole } from "../session";

export const me = new Hono<AppEnv>();

me.get("/me/summary", requireRole("student"), async (c) => {
  const db = c.env.DB;
  const uid = c.get("user")!.id;
  const totals = await db
    .prepare("SELECT COALESCE(SUM(points),0) AS total, COALESCE(SUM(CASE WHEN created_at >= ? THEN points ELSE 0 END),0) AS week FROM activities WHERE user_id = ?")
    .bind(sgWeekStart(Date.now()), uid)
    .first<{ total: number; week: number }>();
  const { results } = await db
    .prepare(
      `SELECT a.type, a.points, a.kg_co2e, a.low_carbon, a.verified, a.created_at, i.name AS item_name
       FROM activities a LEFT JOIN items i ON i.id = a.item_id
       WHERE a.user_id = ? ORDER BY a.created_at DESC LIMIT 20`,
    )
    .bind(uid)
    .all<{ type: string; points: number; kg_co2e: number | null; low_carbon: number | null; verified: number; created_at: number; item_name: string | null }>();
  return c.json({
    points_total: totals?.total ?? 0,
    points_week: totals?.week ?? 0,
    recent: results.map((r) => ({
      ...r,
      low_carbon: r.low_carbon == null ? null : r.low_carbon === 1,
      verified: r.verified === 1,
    })),
  });
});
