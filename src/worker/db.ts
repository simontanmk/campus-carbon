import { parseSettings, type Settings } from "./lib/settings";

export async function loadSettings(db: D1Database): Promise<Settings> {
  const { results } = await db.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  return parseSettings(results);
}
