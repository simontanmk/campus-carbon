import { rank, periodPoints, type Ranked } from "./lib/leaderboard";
import type { Act } from "./lib/missions";

type Row = { user_id: string; created_at: number; type: string; low_carbon: number | null; points: number; verified: number; detail_json: string };

/** Student activity as pure-module input. */
export async function loadActs(db: D1Database, opts: { userId?: string; from?: number } = {}): Promise<(Act & { user_id: string })[]> {
  const { results } = await db
    .prepare(
      `SELECT a.user_id, a.created_at, a.type, a.low_carbon, a.points, a.verified, a.detail_json
       FROM activities a JOIN users u ON u.id = a.user_id
       WHERE u.role = 'student' AND (?1 IS NULL OR a.user_id = ?1) AND a.created_at >= ?2`,
    )
    .bind(opts.userId ?? null, opts.from ?? 0)
    .all<Row>();
  return results.map(({ detail_json, ...r }) => ({ ...r, detail: JSON.parse(detail_json || "{}") }));
}

/** Ranked students for [from, to). */
export async function standings(db: D1Database, from: number, to: number): Promise<Ranked[]> {
  const [acts, users] = await Promise.all([
    loadActs(db, { from }),
    db.prepare("SELECT id, display_name FROM users WHERE role = 'student'").all<{ id: string; display_name: string }>(),
  ]);
  const byUser = new Map<string, Act[]>();
  for (const a of acts) if (a.created_at < to) byUser.set(a.user_id, [...(byUser.get(a.user_id) ?? []), a]);
  return rank(users.results.map((u) => ({ user_id: u.id, display_name: u.display_name, points: periodPoints(byUser.get(u.id) ?? [], from, to) })));
}
