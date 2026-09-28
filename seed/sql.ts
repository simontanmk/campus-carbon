import { computeKg, isLowCarbonMeal, type FactorTable } from "../src/worker/lib/carbon.ts";
import { FACTORS, ITEMS, SETTINGS, STALLS, USERS } from "./data.ts";

type Val = string | number | null;

function lit(v: Val): string {
  if (v === null) return "NULL";
  if (typeof v === "number") return String(v);
  return `'${v.replace(/'/g, "''")}'`;
}

function upsert(table: string, row: Record<string, Val>): string {
  const cols = Object.keys(row);
  return `INSERT OR REPLACE INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((c) => lit(row[c])).join(", ")});`;
}

export function buildSeedSql(now: number = Date.now()): string {
  const factorTable: FactorTable = Object.fromEntries(
    FACTORS.filter((f) => f.unit === "kg").map((f) => [f.key, f.kg_per_unit]),
  );
  const created = now - 14 * 86_400_000;
  const out: string[] = [];

  for (const f of FACTORS) out.push(upsert("factors", { ...f }));
  for (const s of STALLS) out.push(upsert("stalls", { ...s, active: 1 }));
  for (const u of USERS) out.push(upsert("users", { ...u, created_at: created }));
  for (const i of ITEMS) {
    const kg = i.kg_override ?? computeKg(i.parts, factorTable);
    const low = i.kind === "meal" && isLowCarbonMeal(i.parts) ? 1 : 0;
    out.push(
      upsert("items", {
        id: i.id,
        stall_id: i.stall_id,
        name: i.name,
        kind: i.kind,
        parts_json: JSON.stringify(i.parts),
        kg_co2e: kg,
        low_carbon: low,
        points: null,
        status: "live",
      }),
    );
  }
  for (const [key, value] of Object.entries(SETTINGS)) out.push(upsert("settings", { key, value: String(value) }));

  return out.join("\n") + "\n";
}
