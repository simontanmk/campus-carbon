import { Hono } from "hono";
import { loadActs, standings } from "../acts";
import { loadMenuKg, loadMissionPoints } from "../db";
import type { AppEnv } from "../env";
import { averageMealKg } from "../lib/insights";
import { buildRecap, recapRange, type RecapWeek } from "../lib/recap";
import { requireRole } from "../session";

export const recap = new Hono<AppEnv>();

recap.get("/me/recap", requireRole("student"), async (c) => {
  const db = c.env.DB;
  const user = c.get("user")!;
  const now = Date.now();
  const week: RecapWeek = c.req.query("week") === "this" ? "this" : "last";
  const { from, to } = recapRange(week, now);
  const pointsP = loadMissionPoints(db);
  const [acts, createdAt, menu, [points, ranked]] = await Promise.all([
    loadActs(db, { userId: user.id }),
    db.prepare("SELECT created_at FROM users WHERE id = ?").bind(user.id).first<number>("created_at"),
    loadMenuKg(db),
    pointsP.then(async (p) => [p, await standings(db, from, to, p)] as const),
  ]);
  return c.json(buildRecap({
    week, now, userId: user.id, displayName: user.display_name, createdAt: createdAt ?? now,
    acts, avgMealKg: averageMealKg(menu), ranked, points,
  }));
});
