import type { MenuItemKg } from "./lib/insights";
import { parseSettings, type Settings } from "./lib/settings";

export async function loadSettings(db: D1Database): Promise<Settings> {
  const { results } = await db.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  return parseSettings(results);
}

/** Mission rewards as admin set them over time; each applies from the SGT week it was saved. */
export async function loadMissionPoints(db: D1Database): Promise<(weekStart: number) => Record<string, number>> {
  const { results } = await db
    .prepare("SELECT mission_id, effective_from, points FROM mission_points ORDER BY effective_from")
    .all<{ mission_id: string; effective_from: number; points: number }>();
  return (weekStart) => {
    const out: Record<string, number> = {};
    for (const r of results) if (r.effective_from <= weekStart) out[r.mission_id] = r.points;
    return out;
  };
}

/** Every item with its stall's active flag, for the average-campus-meal estimate. */
export async function loadMenuKg(db: D1Database): Promise<MenuItemKg[]> {
  const { results } = await db.prepare("SELECT i.kind, i.status, i.kg_co2e, s.active AS stall_active FROM items i JOIN stalls s ON s.id = i.stall_id").all<MenuItemKg>();
  return results;
}
