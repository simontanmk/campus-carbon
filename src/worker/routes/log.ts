import { Hono } from "hono";
import { insertActivity, insertCapped } from "../activities";
import { loadSettings } from "../db";
import type { AppEnv } from "../env";
import { fail, readBody } from "../http";
import { tripOptions, type Mode } from "../lib/mobility";
import { requireRole } from "../session";

export const log = new Hono<AppEnv>();
const student = requireRole("student");
const MODES: Mode[] = ["walk", "shuttle", "car"];

type Place = { id: string; name: string };
type RouteRow = { distance_km: number; walk_min: number; shuttle_min: number | null; car_min: number | null };

async function place(db: D1Database, id: unknown): Promise<Place | null> {
  if (typeof id !== "string" || id === "") return null;
  return db.prepare("SELECT id, name FROM locations WHERE id = ?").bind(id).first<Place>();
}

async function resolveTrip(db: D1Database, fromId: unknown, toId: unknown) {
  const [from, to] = await Promise.all([place(db, fromId), place(db, toId)]);
  if (!from || !to) return { error: [400, "unknown_place", "Pick places from the list."] as const };
  if (from.id === to.id) return { error: [400, "same_place", "Pick two different places."] as const };
  const route = await db
    .prepare("SELECT distance_km, walk_min, shuttle_min, car_min FROM routes WHERE (from_id = ?1 AND to_id = ?2) OR (from_id = ?2 AND to_id = ?1)")
    .bind(from.id, to.id)
    .first<RouteRow>();
  if (!route) return { error: [404, "no_route", "We don't have that route yet."] as const };
  const f = await db.prepare("SELECT key, kg_per_unit FROM factors WHERE key IN ('shuttle','car')").all<{ key: string; kg_per_unit: number | null }>();
  const factors = { shuttle: null as number | null, car: null as number | null };
  for (const r of f.results) factors[r.key as "shuttle" | "car"] = r.kg_per_unit;
  return { error: null, from, to, route, factors };
}

const isInt = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

log.get("/locations", student, async (c) => {
  const { results } = await c.env.DB.prepare("SELECT id, name FROM locations ORDER BY name").all<Place>();
  return c.json({ locations: results });
});

log.get("/trips/options", student, async (c) => {
  const t = await resolveTrip(c.env.DB, c.req.query("from"), c.req.query("to"));
  if (t.error) return fail(c, t.error[0], t.error[1], t.error[2]);
  const s = await loadSettings(c.env.DB);
  return c.json({ from: t.from, to: t.to, distance_km: t.route.distance_km, options: tripOptions(t.route, t.factors, s) });
});

log.post("/trips", student, async (c) => {
  const db = c.env.DB;
  const body = (await readBody(c)) as { from_id?: unknown; to_id?: unknown; mode?: unknown };
  const t = await resolveTrip(db, body.from_id, body.to_id);
  if (t.error) return fail(c, t.error[0], t.error[1], t.error[2]);
  if (!MODES.includes(body.mode as Mode)) return fail(c, 400, "invalid_mode", "Pick walk, shuttle or car.");
  const s = await loadSettings(db);
  const option = tripOptions(t.route, t.factors, s).find((o) => o.mode === body.mode);
  if (!option) return fail(c, 400, "invalid_mode", "That option isn't available for this route.");
  const points = await insertCapped(
    db,
    { user_id: c.get("user")!.id, category: "mobility", type: "trip", kg_co2e: option.kg_co2e, detail: { from_id: t.from.id, to_id: t.to.id, mode: option.mode, distance_km: t.route.distance_km } },
    option.points,
    s.self_reported_daily_cap,
    Date.now(),
  );
  return c.json({ points, capped: points < option.points, kg_co2e: option.kg_co2e }, 201);
});

log.post("/steps", student, async (c) => {
  const body = (await readBody(c)) as { steps?: unknown };
  if (!isInt(body.steps, 1, 100_000)) return fail(c, 400, "invalid_steps", "Enter a whole number of steps up to 100,000.");
  await insertActivity(c.env.DB, {
    user_id: c.get("user")!.id, category: "mobility", type: "steps", kg_co2e: null, points: 0, verified: false, source: "manual",
    detail: { steps: body.steps }, created_at: Date.now(),
  }).run();
  return c.json({ points: 0, steps: body.steps }, 201);
});
