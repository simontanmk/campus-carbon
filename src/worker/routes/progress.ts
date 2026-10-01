import { Hono } from "hono";
import { loadActs, standings } from "../acts";
import { loadMissionPoints } from "../db";
import type { AppEnv } from "../env";
import { badgeStates } from "../lib/badges";
import { currentMissions } from "../lib/missions";
import { streak } from "../lib/streak";
import { sgWeekStart } from "../lib/time";
import { requireRole } from "../session";

export const progress = new Hono<AppEnv>();
const student = requireRole("student");
const WEEK = 7 * 86_400_000;

progress.get("/missions", student, async (c) => {
  const db = c.env.DB;
  const uid = c.get("user")!.id;
  const now = Date.now();
  const thisWeek = sgWeekStart(now);
  const points = await loadMissionPoints(db);
  const [acts, lastWeek] = await Promise.all([loadActs(db, { userId: uid }), standings(db, thisWeek - WEEK, thisWeek, points)]);
  const champion = lastWeek.some((r) => r.rank === 1 && r.user_id === uid) ? thisWeek - WEEK : null;
  return c.json({
    streak: streak(acts.map((a) => a.created_at), now),
    ...currentMissions(acts, now, points),
    badges: badgeStates(acts, champion),
  });
});

progress.get("/leaderboard", student, async (c) => {
  const uid = c.get("user")!.id;
  const now = Date.now();
  const ranked = await standings(c.env.DB, sgWeekStart(now), now + 1, await loadMissionPoints(c.env.DB));
  const mine = ranked.find((r) => r.user_id === uid);
  return c.json({
    top: ranked.slice(0, 20).map((r) => ({ rank: r.rank, display_name: r.display_name, points: r.points, me: r.user_id === uid })),
    me: mine ? { rank: mine.rank, points: mine.points } : { rank: null, points: 0 },
  });
});
