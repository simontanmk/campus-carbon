import { computeKg, isLowCarbonMeal, type FactorTable } from "../src/worker/lib/carbon.ts";
import { BADGES } from "../src/worker/lib/badges.ts";
import { MISSIONS } from "../src/worker/lib/missions.ts";
import { DEFAULT_SETTINGS } from "../src/worker/lib/settings.ts";
import { sgDayStart } from "../src/worker/lib/time.ts";
import { FACTORS, ITEMS, LOCATIONS, PERSONA_HISTORY, SETTINGS, STALLS, USERS } from "./data.ts";
import routes from "./routes.json" with { type: "json" };

type Val = string | number | null;
type Route = { from_id: string; to_id: string; distance_km: number; walk_min: number; car_min: number; shuttle_min: number };

const DAY = 86_400_000;
const HOUR = 3_600_000;

function lit(v: Val): string {
  if (v === null) return "NULL";
  if (typeof v === "number") return String(v);
  return `'${v.replace(/'/g, "''")}'`;
}

/** INSERT … ON CONFLICT: `update` lists the seed-owned columns; an empty list means DO NOTHING. */
function upsert(table: string, row: Record<string, Val>, conflict: string[], update: string[]): string {
  const cols = Object.keys(row);
  const action = update.length ? `DO UPDATE SET ${update.map((c) => `${c} = excluded.${c}`).join(", ")}` : "DO NOTHING";
  return `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((c) => lit(row[c])).join(", ")}) ON CONFLICT(${conflict.join(", ")}) ${action};`;
}

export function buildSeedSql(now: number = Date.now()): string {
  const factorTable: FactorTable = Object.fromEntries(FACTORS.filter((f) => f.unit === "kg").map((f) => [f.key, f.kg_per_unit]));
  const factorOf = (k: string) => FACTORS.find((f) => f.key === k)!.kg_per_unit;
  // SGT midnight, so each history entry's hour is its SGT clock time and day 13 is always yesterday or earlier.
  const created = sgDayStart(now) - 14 * DAY;
  const out: string[] = [];

  for (const f of FACTORS) out.push(upsert("factors", { ...f }, ["key"], ["kg_per_unit", "unit", "source", "note"]));
  for (const s of STALLS) out.push(upsert("stalls", { ...s, active: 1 }, ["id"], ["name", "canteen"]));
  for (const u of USERS) out.push(upsert("users", { ...u, created_at: created }, ["id"], []));
  const itemKg = new Map<string, { kg: number | null; low: number; stall: string; kind: string }>();
  for (const i of ITEMS) {
    const kg = i.kg_override ?? computeKg(i.parts, factorTable);
    const low = i.kind === "meal" && isLowCarbonMeal(i.parts) ? 1 : 0;
    itemKg.set(i.id, { kg, low, stall: i.stall_id, kind: i.kind });
    out.push(
      upsert(
        "items",
        { id: i.id, stall_id: i.stall_id, name: i.name, kind: i.kind, parts_json: JSON.stringify(i.parts), kg_co2e: kg, low_carbon: low, points: null, status: "live" },
        ["id"],
        ["stall_id", "name", "kind", "parts_json", "kg_co2e", "low_carbon"],
      ),
    );
  }
  for (const [key, value] of Object.entries(SETTINGS)) out.push(upsert("settings", { key, value: String(value) }, ["key"], []));
  for (const l of LOCATIONS) out.push(upsert("locations", { ...l }, ["id"], ["name", "lat", "lon"]));
  for (const r of routes as Route[]) {
    out.push(
      upsert(
        "routes",
        { ...r, placeholder: 0, source: "OpenStreetMap via OSRM (routing.openstreetmap.de); shuttle = drive + 5 min wait" },
        ["from_id", "to_id"],
        ["distance_km", "walk_min", "shuttle_min", "car_min", "placeholder", "source"],
      ),
    );
  }

  for (const m of MISSIONS) {
    out.push(upsert("missions", { id: m.id, name: m.name, category: m.category, metric: m.metric, target: m.target, points: m.points, period: m.period }, ["id"], ["name", "category", "metric", "target", "points", "period"]));
  }
  for (const b of BADGES) out.push(upsert("badges", { ...b }, ["id"], ["name", "rule"]));

  // Persona history, anchored to each persona's own created_at so re-seeding never shifts it.
  const findRoute = (a: string, b: string) =>
    (routes as Route[]).find((r) => (r.from_id === a && r.to_id === b) || (r.from_id === b && r.to_id === a));
  for (const [uid, entries] of Object.entries(PERSONA_HISTORY)) {
    entries.forEach((e, n) => {
      const at = `(SELECT created_at FROM users WHERE id = ${lit(uid)}) + ${e.day * DAY + e.hour * HOUR}`;
      const id = `seed-${uid}-${n}`; // by position: PERSONA_HISTORY arrays are append-only (see data.ts)
      let cols: Record<string, Val>;
      if (e.kind === "trip") {
        const route = findRoute(e.from, e.to);
        if (!route) throw new Error(`no route ${e.from} → ${e.to}`);
        const factor = e.mode === "walk" ? 0 : factorOf(e.mode);
        const kg = factor == null ? null : Math.round(route.distance_km * factor * 100) / 100;
        const points = e.mode === "walk" ? DEFAULT_SETTINGS.points_walk_trip : e.mode === "shuttle" ? DEFAULT_SETTINGS.points_shuttle_trip : 0;
        cols = { id, user_id: uid, category: "mobility", type: "trip", kg_co2e: kg, points, verified: 0, source: "manual", stall_id: null, item_id: null, low_carbon: null, detail_json: JSON.stringify({ from_id: e.from, to_id: e.to, mode: e.mode, distance_km: route.distance_km }) };
      } else {
        const it = itemKg.get(e.item)!;
        const low = e.kind === "meal" ? it.low : null;
        const points = e.kind === "meal" && it.low === 1 ? DEFAULT_SETTINGS.points_meal_low_carbon : 0;
        cols = { id, user_id: uid, category: "food", type: e.kind, kg_co2e: it.kg, points, verified: 1, source: "qr", stall_id: it.stall, item_id: e.item, low_carbon: low, detail_json: "{}" };
      }
      out.push(historyInsert(cols, at));
      if (e.kind !== "trip" && e.byo) {
        const it = itemKg.get(e.item)!;
        out.push(historyInsert({ id: `${id}-byo`, user_id: uid, category: "waste", type: "byo", kg_co2e: null, points: DEFAULT_SETTINGS.points_byo, verified: 1, source: "qr", stall_id: it.stall, item_id: null, low_carbon: null, detail_json: "{}" }, at));
      }
    });
  }

  return out.join("\n") + "\n";
}

function historyInsert(cols: Record<string, Val>, createdAtExpr: string): string {
  const names = [...Object.keys(cols), "created_at"];
  const values = [...Object.values(cols).map(lit), createdAtExpr];
  return `INSERT INTO activities (${names.join(", ")}) SELECT ${values.join(", ")} WHERE EXISTS (SELECT 1 FROM users WHERE id = ${lit(cols.user_id as string)}) ON CONFLICT(id) DO NOTHING;`;
}
