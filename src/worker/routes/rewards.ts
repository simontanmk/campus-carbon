import { Hono } from "hono";
import type { AppEnv } from "../env";
import { fail, readBody } from "../http";
import { newCode, normalizeCode } from "../lib/codes";
import { sgWeekStart } from "../lib/time";
import { earnedPoints } from "../points";
import { requireRole } from "../session";

export const rewards = new Hono<AppEnv>();
const student = requireRole("student");
const seller = requireRole("seller");
export const HOLD_MS = 10 * 60_000;
const PENDING = "Use or cancel your current code first.";
/** A redemption still counts against the balance and stock: confirmed, or on hold and not lapsed. */
const LIVE = "(status = 'redeemed' OR (status = 'pending' AND expires_at > ?now))";

async function spentBy(db: D1Database, uid: string, now: number): Promise<number> {
  return (await db.prepare(`SELECT COALESCE(SUM(cost), 0) AS n FROM redemptions WHERE user_id = ?1 AND ${LIVE.replace("?now", "?2")}`).bind(uid, now).first<number>("n")) ?? 0;
}

async function usedThisWeek(db: D1Database, rewardId: string, now: number): Promise<number> {
  return (await db.prepare(`SELECT COUNT(*) AS n FROM redemptions WHERE reward_id = ?1 AND created_at >= ?2 AND ${LIVE.replace("?now", "?3")}`)
    .bind(rewardId, sgWeekStart(now), now).first<number>("n")) ?? 0;
}

async function livePending(db: D1Database, uid: string, now: number) {
  return db
    .prepare("SELECT r.id, r.code, r.cost, r.expires_at, w.name AS reward_name FROM redemptions r JOIN rewards w ON w.id = r.reward_id WHERE r.user_id = ? AND r.status = 'pending' AND r.expires_at > ?")
    .bind(uid, now)
    .first<{ id: string; code: string; cost: number; expires_at: number; reward_name: string }>();
}

rewards.get("/rewards", student, async (c) => {
  const db = c.env.DB;
  const uid = c.get("user")!.id;
  const now = Date.now();
  const [earned, spent, list, active, history] = await Promise.all([
    earnedPoints(db, uid, now),
    spentBy(db, uid, now),
    db.prepare(
      `SELECT w.id, w.name, w.cost, s.name AS stall_name, w.weekly_stock,
              (SELECT COUNT(*) FROM redemptions r WHERE r.reward_id = w.id AND r.created_at >= ?1 AND (r.status = 'redeemed' OR (r.status = 'pending' AND r.expires_at > ?2))) AS used
       FROM rewards w LEFT JOIN stalls s ON s.id = w.stall_id WHERE w.active = 1 ORDER BY w.cost, w.name`,
    ).bind(sgWeekStart(now), now).all<{ id: string; name: string; cost: number; stall_name: string | null; weekly_stock: number | null; used: number }>(),
    livePending(db, uid, now),
    db.prepare(
      `SELECT w.name AS reward_name, r.cost, r.redeemed_at, s.name AS stall_name
       FROM redemptions r JOIN rewards w ON w.id = r.reward_id LEFT JOIN stalls s ON s.id = r.stall_id
       WHERE r.user_id = ? AND r.status = 'redeemed' ORDER BY r.redeemed_at DESC LIMIT 10`,
    ).bind(uid).all<{ reward_name: string; cost: number; redeemed_at: number; stall_name: string | null }>(),
  ]);
  const balance = Math.max(0, earned - spent);
  return c.json({
    balance, earned, spent,
    rewards: list.results.map((w) => ({
      id: w.id, name: w.name, cost: w.cost, stall_name: w.stall_name,
      left_this_week: w.weekly_stock == null ? null : Math.max(0, w.weekly_stock - w.used),
      affordable: balance >= w.cost,
    })),
    active: active ? { ...active, server_now: now } : null,
    history: history.results,
  });
});

// One statement: the balance and weekly stock are checked as the row goes in (spec §6.1).
const ISSUE = `INSERT INTO redemptions (id, user_id, reward_id, code, cost, status, created_at, expires_at)
  SELECT ?1, ?2, r.id, ?4, r.cost, 'pending', ?5, ?6 FROM rewards r
  WHERE r.id = ?3 AND r.active = 1
    AND ?7 - (SELECT COALESCE(SUM(cost), 0) FROM redemptions WHERE user_id = ?2 AND (status = 'redeemed' OR (status = 'pending' AND expires_at > ?5))) >= r.cost
    AND (r.weekly_stock IS NULL OR (SELECT COUNT(*) FROM redemptions WHERE reward_id = r.id AND created_at >= ?8
          AND (status = 'redeemed' OR (status = 'pending' AND expires_at > ?5))) < r.weekly_stock)
  RETURNING cost`;

rewards.post("/rewards/:id/redeem", student, async (c) => {
  const db = c.env.DB;
  const uid = c.get("user")!.id;
  const rid = c.req.param("id");
  const now = Date.now();
  const reward = await db.prepare("SELECT id, name, cost, weekly_stock FROM rewards WHERE id = ? AND active = 1").bind(rid)
    .first<{ id: string; name: string; cost: number; weekly_stock: number | null }>();
  if (!reward) return fail(c, 404, "no_reward", "That reward isn't available.");
  // Lapsed holds are free again; clearing them keeps them from blocking the partial unique indexes.
  await db.prepare("UPDATE redemptions SET status = 'expired' WHERE status = 'pending' AND expires_at <= ?").bind(now).run();
  if (await livePending(db, uid, now)) return fail(c, 409, "already_pending", PENDING);
  const earned = await earnedPoints(db, uid, now);
  for (let attempt = 0; attempt < 3; attempt++) {
    const id = crypto.randomUUID();
    const code = newCode();
    let row: { cost: number } | null;
    try {
      row = await db.prepare(ISSUE).bind(id, uid, rid, code, now, now + HOLD_MS, earned, sgWeekStart(now)).first<{ cost: number }>();
    } catch (e) {
      const msg = String(e);
      if (msg.includes("UNIQUE") && msg.includes("redemptions.code")) continue; // another live code has these letters
      if (msg.includes("UNIQUE")) return fail(c, 409, "already_pending", PENDING); // a second tap won the race
      throw e;
    }
    if (row) return c.json({ id, code, reward_name: reward.name, cost: row.cost, expires_at: now + HOLD_MS, server_now: now }, 201);
    // Nothing inserted: a concurrent code from this student explains it first (its hold also lowers balance and stock).
    if (await livePending(db, uid, now)) return fail(c, 409, "already_pending", PENDING);
    if (reward.weekly_stock != null && (await usedThisWeek(db, rid, now)) >= reward.weekly_stock) {
      return fail(c, 409, "out_of_stock", "All gone this week. Back on Monday.");
    }
    const balance = earned - (await spentBy(db, uid, now));
    if (balance < reward.cost) return fail(c, 409, "insufficient", `You need ${reward.cost - balance} more points.`);
    return fail(c, 404, "no_reward", "That reward isn't available.");
  }
  return fail(c, 503, "busy", "Couldn't make a code just now. Try again.");
});

rewards.get("/rewards/redemptions/:id", student, async (c) => {
  const r = await c.env.DB.prepare("SELECT user_id, status, expires_at FROM redemptions WHERE id = ?").bind(c.req.param("id"))
    .first<{ user_id: string; status: string; expires_at: number }>();
  if (!r || r.user_id !== c.get("user")!.id) return fail(c, 404, "not_found", "Code not found.");
  return c.json({ status: r.status === "pending" && r.expires_at <= Date.now() ? "expired" : r.status });
});

rewards.post("/rewards/redemptions/:id/cancel", student, async (c) => {
  const upd = await c.env.DB.prepare("UPDATE redemptions SET status = 'expired' WHERE id = ? AND user_id = ? AND status = 'pending'")
    .bind(c.req.param("id"), c.get("user")!.id).run();
  if (upd.meta.changes !== 1) return fail(c, 409, "not_pending", "This code can't be cancelled.");
  return c.json({ cancelled: true });
});

// The stall is the session's, never a parameter (spec §8). The first of two confirms wins.
rewards.post("/stall/redeem", seller, async (c) => {
  const db = c.env.DB;
  const stall = c.get("user")!.stall_id;
  if (!stall) return fail(c, 404, "no_stall", "This seller account isn't linked to a stall.");
  const raw = (await readBody(c)).code;
  const code = normalizeCode(raw);
  if (!code) {
    const confusable = typeof raw === "string" && /[OIL01]/i.test(raw);
    return fail(c, 400, "invalid_code", confusable ? "Codes never use O, I, L, 0 or 1. Check the letters with the student." : "Codes are 6 letters and numbers.");
  }
  const now = Date.now();
  const done = await db
    .prepare(
      `UPDATE redemptions SET status = 'redeemed', redeemed_at = ?1, stall_id = ?2
       WHERE code = ?3 AND status = 'pending' AND expires_at > ?1
         AND reward_id IN (SELECT id FROM rewards WHERE stall_id IS NULL OR stall_id = ?2)
       RETURNING user_id, reward_id, cost`,
    )
    .bind(now, stall, code)
    .first<{ user_id: string; reward_id: string; cost: number }>();
  if (done) {
    const [u, w] = await Promise.all([
      db.prepare("SELECT display_name FROM users WHERE id = ?").bind(done.user_id).first<string>("display_name"),
      db.prepare("SELECT name FROM rewards WHERE id = ?").bind(done.reward_id).first<string>("name"),
    ]);
    return c.json({ reward_name: w, student_name: (u ?? "").trim().split(/\s+/)[0], cost: done.cost });
  }
  const r = await db
    .prepare(
      `SELECT r.status, r.expires_at, r.redeemed_at, r.stall_id AS confirmed_at_stall, s.name AS stall_name FROM redemptions r JOIN rewards w ON w.id = r.reward_id
       LEFT JOIN stalls s ON s.id = w.stall_id WHERE r.code = ? ORDER BY r.created_at DESC LIMIT 1`,
    )
    .bind(code)
    .first<{ status: string; expires_at: number; redeemed_at: number | null; confirmed_at_stall: string | null; stall_name: string | null }>();
  if (!r) return fail(c, 404, "not_found", "No reward with that code. Check the letters with the student.");
  if (r.status === "redeemed") {
    // A seller whose confirm reply was lost and who taps again shouldn't think the student was turned away.
    if (r.confirmed_at_stall === stall && r.redeemed_at != null) {
      const at = new Date(r.redeemed_at).toLocaleTimeString("en-SG", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Singapore" });
      return fail(c, 409, "used", `Already confirmed here at ${at}.`);
    }
    return fail(c, 409, "used", "This code has already been used.");
  }
  if (r.status === "expired" || r.expires_at <= now) return fail(c, 410, "expired", "This code has expired. Ask the student to tap Redeem again.");
  return fail(c, 403, "wrong_stall", `This reward is for ${r.stall_name}.`);
});
