import { rank, periodPoints, type Ranked } from "./lib/leaderboard.ts";
import type { Act, MissionPoints } from "./lib/missions.ts";

type Category = "food" | "mobility" | "waste";
type Row = { user_id: string; created_at: number; type: string; category: Category; kg_co2e: number | null; low_carbon: number | null; points: number; verified: number; detail_json: string };
export type LoadedAct = Act & { user_id: string; category: Category; kg_co2e: number | null };

/** Student activity in [from, to) as pure-module input. */
export async function loadActs(db: D1Database, opts: { userId?: string; from?: number; to?: number } = {}): Promise<LoadedAct[]> {
  const { results } = await db
    .prepare(
      `SELECT a.user_id, a.created_at, a.type, a.category, a.kg_co2e, a.low_carbon, a.points, a.verified, a.detail_json
       FROM activities a JOIN users u ON u.id = a.user_id
       WHERE u.role = 'student' AND (?1 IS NULL OR a.user_id = ?1) AND a.created_at >= ?2 AND (?3 IS NULL OR a.created_at < ?3)`,
    )
    .bind(opts.userId ?? null, opts.from ?? 0, opts.to ?? null)
    .all<Row>();
  return results.map(({ detail_json, ...r }) => ({ ...r, detail: safeJson(detail_json) }));
}

/** Ranked students for [from, to). */
export async function standings(db: D1Database, from: number, to: number, points?: MissionPoints): Promise<Ranked[]> {
  const [acts, users] = await Promise.all([
    loadActs(db, { from, to }),
    db.prepare("SELECT id, display_name FROM users WHERE role = 'student'").all<{ id: string; display_name: string }>(),
  ]);
  const byUser = new Map<string, Act[]>();
  for (const a of acts) {
    const list = byUser.get(a.user_id);
    if (list) list.push(a);
    else byUser.set(a.user_id, [a]);
  }
  return rank(users.results.map((u) => ({ user_id: u.id, display_name: u.display_name, points: periodPoints(byUser.get(u.id) ?? [], from, to, points) })));
}

export function safeJson(s: string | null): Record<string, unknown> {
  try {
    const v = JSON.parse(s || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
