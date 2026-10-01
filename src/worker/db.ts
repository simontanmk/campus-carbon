import type { MissionPoints } from "./lib/missions";
import { parseSettings, type Settings } from "./lib/settings";

export async function loadSettings(db: D1Database): Promise<Settings> {
  const { results } = await db.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  return parseSettings(results);
}

const MISSION_PREFIX = "mission_points_";

export async function loadMissionPoints(db: D1Database): Promise<MissionPoints> {
  const { results } = await db.prepare("SELECT key, value FROM settings WHERE key LIKE 'mission_points_%'").all<{ key: string; value: string }>();
  const out: MissionPoints = {};
  for (const r of results) {
    const n = Number(r.value);
    if (Number.isFinite(n)) out[r.key.slice(MISSION_PREFIX.length)] = n;
  }
  return out;
}
