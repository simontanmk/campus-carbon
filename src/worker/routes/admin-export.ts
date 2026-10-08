import { Hono } from "hono";
import type { AppEnv } from "../env";
import { toCsv } from "../lib/csv";
import { sgWeekStart } from "../lib/time";
import { requireRole } from "../session";

export const adminExport = new Hono<AppEnv>();
const SG = 8 * 3_600_000;
export const sgIso = (ms: number) => new Date(ms + SG).toISOString().replace(/\.\d{3}Z$/, "+08:00");
export const sgDate = (ms: number) => new Date(ms + SG).toISOString().slice(0, 10);
const HEADER = [
  "activity_id", "user_id", "category", "type", "verified", "source", "kg_co2e", "points", "low_carbon",
  "stall_id", "canteen", "item_id", "item_name", "dish", "ai", "mode", "from_id", "to_id", "distance_km", "steps", "count",
  "image_hash", "token_id", "token_created_at_sgt", "confirmed_at_sgt", "confirm_latency_ms", "created_at_sgt", "week_start_sgt",
  "receipt_provider", "refunded_at_sgt",
];

adminExport.get("/admin/export.csv", requireRole("admin"), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.user_id, a.category, a.type, a.verified, a.source, a.kg_co2e, a.points, a.low_carbon, a.stall_id, s.canteen, a.item_id, i.name AS item_name,
            a.detail_json, a.image_hash, a.token_id, t.created_at AS token_created_at, t.confirmed_at, a.created_at
     FROM activities a LEFT JOIN stalls s ON s.id = a.stall_id LEFT JOIN items i ON i.id = a.item_id LEFT JOIN tokens t ON t.id = a.token_id
     ORDER BY a.created_at`,
  ).all<Record<string, any>>();
  const rows = results.map((r) => {
    let d: Record<string, unknown> = {};
    try { d = JSON.parse(r.detail_json || "{}") ?? {}; } catch { /* keep {} */ }
    const str = (v: unknown) => (typeof v === "string" ? v : null);
    const num = (v: unknown) => (typeof v === "number" ? v : null);
    // Confirm latency (spec §8.2 step 4) exists only for NFC: seller's item tap → seller's Confirm.
    const latency = r.confirmed_at != null && r.token_created_at != null ? r.confirmed_at - r.token_created_at : null;
    return [r.id, r.user_id, r.category, r.type, r.verified, r.source, r.kg_co2e, r.points, r.low_carbon, r.stall_id, r.canteen, r.item_id, r.item_name,
      str(d.dish), str(d.ai), str(d.mode), str(d.from_id), str(d.to_id), num(d.distance_km), num(d.steps), num(d.count),
      r.image_hash, r.token_id, r.token_created_at != null ? sgIso(r.token_created_at) : null, r.confirmed_at != null ? sgIso(r.confirmed_at) : null, latency,
      sgIso(r.created_at), sgDate(sgWeekStart(r.created_at)), str(d.provider), str(d.refunded_at)];
  });
  return c.body(toCsv(HEADER, rows), 200, {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="activities-${sgDate(Date.now())}.csv"`,
  });
});
