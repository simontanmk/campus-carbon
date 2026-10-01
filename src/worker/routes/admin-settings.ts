import { Hono } from "hono";
import { loadMissionPoints, loadSettings } from "../db";
import type { AppEnv } from "../env";
import { fail, readBody } from "../http";
import { MISSIONS } from "../lib/missions";
import { DEFAULT_SETTINGS } from "../lib/settings";
import { requireRole } from "../session";

export const adminSettings = new Hono<AppEnv>();
const admin = requireRole("admin");
const MISSION_KEYS = new Set(MISSIONS.map((m) => `mission_points_${m.id}`));

async function payload(db: D1Database) {
  const [settings, pts] = await Promise.all([loadSettings(db), loadMissionPoints(db)]);
  return { settings, missions: MISSIONS.map((m) => ({ id: m.id, name: m.name, points: pts[m.id] ?? m.points, default_points: m.points })) };
}

adminSettings.get("/admin/settings", admin, async (c) => c.json(await payload(c.env.DB)));

adminSettings.post("/admin/settings", admin, async (c) => {
  const b = await readBody(c);
  const values = b.values;
  const entries = values && typeof values === "object" && !Array.isArray(values) ? Object.entries(values as Record<string, unknown>) : [];
  const ok = entries.length > 0 && entries.every(([k, v]) =>
    (k in DEFAULT_SETTINGS || MISSION_KEYS.has(k)) && typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100_000);
  if (!ok) return fail(c, 400, "invalid_setting", "Each value must be a whole number from 0 to 100,000 for a known setting.");
  const db = c.env.DB;
  await db.batch(entries.map(([k, v]) => db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(k, String(v))));
  return c.json(await payload(db));
});
