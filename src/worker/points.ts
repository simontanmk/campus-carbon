import { loadActs } from "./acts";
import { loadMissionPoints } from "./db";
import { missionPoints } from "./lib/missions";

/** Lifetime points earned, exactly as Today shows them (points_total). Spending is tracked separately. */
export async function earnedPoints(db: D1Database, uid: string, now = Date.now()): Promise<number> {
  const [sum, acts, pts] = await Promise.all([
    db.prepare("SELECT COALESCE(SUM(points), 0) AS n FROM activities WHERE user_id = ?").bind(uid).first<number>("n"),
    loadActs(db, { userId: uid }),
    loadMissionPoints(db),
  ]);
  return (sum ?? 0) + missionPoints(acts, 0, now + 1, pts);
}
