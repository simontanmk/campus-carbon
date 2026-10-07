import { Hono } from "hono";
import { safeJson } from "../acts";
import { loadMenuKg } from "../db";
import type { AppEnv } from "../env";
import { fail } from "../http";
import { adminInsights, averageMealKg, impact, stallInsights, weekStarts, type BudgetRow, type InsightAct } from "../lib/insights";
import { sgWeekStart } from "../lib/time";
import { requireRole } from "../session";

export const insights = new Hono<AppEnv>();
const WEEK = 7 * 86_400_000;

type Row = Omit<InsightAct, "detail"> & { detail_json: string };

/** Students' activity from `from`, optionally at one stall, with the item name for top dishes. */
async function loadInsightActs(db: D1Database, from: number, stallId: string | null = null): Promise<InsightAct[]> {
  const { results } = await db
    .prepare(
      `SELECT a.user_id, a.created_at, a.type, a.source, a.verified, a.low_carbon, a.kg_co2e, a.stall_id, a.item_id, a.detail_json, i.name AS item_name
       FROM activities a JOIN users u ON u.id = a.user_id LEFT JOIN items i ON i.id = a.item_id
       WHERE u.role = 'student' AND a.created_at >= ?1 AND (?2 IS NULL OR a.stall_id = ?2)`,
    )
    .bind(from, stallId)
    .all<Row>();
  return results.map(({ detail_json, ...r }) => ({ ...r, detail: safeJson(detail_json) }));
}

// Public: totals only (spec §4.1). Never add names, ids or per-stall figures here.
insights.get("/impact", async (c) => {
  // A Worker's Cache-Control header isn't stored at the edge, so cache explicitly: D1 runs at most once per 30 s per data centre.
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  const key = new Request(`${new URL(c.req.url).origin}/api/impact`);
  const hit = cache ? await cache.match(key) : undefined;
  if (hit) return hit;
  const db = c.env.DB;
  const now = Date.now();
  const lastStart = sgWeekStart(now) - WEEK;
  const [acts, items, budgetRows] = await Promise.all([
    loadInsightActs(db, weekStarts(now)[0]),
    loadMenuKg(db),
    // Budgets need each student's whole history, but only for students who logged kg last week.
    db.prepare(
      `SELECT a.user_id, u.created_at AS user_created_at, a.created_at, a.category, a.kg_co2e
       FROM activities a JOIN users u ON u.id = a.user_id
       WHERE u.role = 'student' AND a.user_id IN (SELECT DISTINCT user_id FROM activities WHERE kg_co2e IS NOT NULL AND created_at >= ?1 AND created_at < ?2)`,
    ).bind(lastStart, lastStart + WEEK).all<BudgetRow>(),
  ]);
  c.header("Cache-Control", "public, max-age=30");
  const res = c.json(impact({ acts, avgMealKg: averageMealKg(items), budgetRows: budgetRows.results, now }));
  if (cache) await cache.put(key, res.clone());
  return res;
});

insights.get("/admin/insights", requireRole("admin"), async (c) => {
  const db = c.env.DB;
  const now = Date.now();
  const [acts, stalls] = await Promise.all([
    loadInsightActs(db, weekStarts(now)[0]),
    db.prepare("SELECT id, name FROM stalls ORDER BY name").all<{ id: string; name: string }>(),
  ]);
  return c.json(adminInsights({ acts, stalls: stalls.results, now }));
});

// The stall comes from the session, never from the request (spec §6).
insights.get("/stall/insights", requireRole("seller"), async (c) => {
  const stallId = c.get("user")!.stall_id;
  if (!stallId) return fail(c, 404, "no_stall", "This seller account isn't linked to a stall.");
  const now = Date.now();
  const acts = await loadInsightActs(c.env.DB, sgWeekStart(now) - WEEK, stallId);
  return c.json(stallInsights(acts, stallId, now));
});
