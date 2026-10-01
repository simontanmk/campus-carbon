import { Hono } from "hono";
import type { AppEnv } from "../env";
import { toCsv } from "../lib/csv";
import { sgWeekStart } from "../lib/time";
import { requireRole } from "../session";

export const adminExport = new Hono<AppEnv>();
const SG = 8 * 3_600_000;
const sgIso = (ms: number) => new Date(ms + SG).toISOString().replace(/\.\d{3}Z$/, "+08:00");
const sgDate = (ms: number) => new Date(ms + SG).toISOString().slice(0, 10);
const HEADER = ["activity_id", "user_id", "category", "type", "verified", "source", "kg_co2e", "points", "low_carbon", "stall_id", "canteen", "item_id", "item_name", "dish", "mode", "distance_km", "created_at_sgt", "week_start_sgt"];

adminExport.get("/admin/export.csv", requireRole("admin"), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.user_id, a.category, a.type, a.verified, a.source, a.kg_co2e, a.points, a.low_carbon, a.stall_id, s.canteen, a.item_id, i.name AS item_name, a.detail_json, a.created_at
     FROM activities a LEFT JOIN stalls s ON s.id = a.stall_id LEFT JOIN items i ON i.id = a.item_id ORDER BY a.created_at`,
  ).all<Record<string, any>>();
  const rows = results.map((r) => {
    let d: Record<string, unknown> = {};
    try { d = JSON.parse(r.detail_json || "{}") ?? {}; } catch { /* keep {} */ }
    const str = (v: unknown) => (typeof v === "string" ? v : null);
    const num = (v: unknown) => (typeof v === "number" ? v : null);
    return [r.id, r.user_id, r.category, r.type, r.verified, r.source, r.kg_co2e, r.points, r.low_carbon, r.stall_id, r.canteen, r.item_id, r.item_name,
      str(d.dish), str(d.mode), num(d.distance_km), sgIso(r.created_at), sgDate(sgWeekStart(r.created_at))];
  });
  return c.body(toCsv(HEADER, rows), 200, {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="activities-${sgDate(Date.now())}.csv"`,
  });
});
