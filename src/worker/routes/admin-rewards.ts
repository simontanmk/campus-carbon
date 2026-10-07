import { Hono } from "hono";
import type { AppEnv } from "../env";
import { fail, readBody } from "../http";
import { toCsv } from "../lib/csv";
import { sgWeekStart } from "../lib/time";
import { requireRole } from "../session";
import { sgDate, sgIso } from "./admin-export";

export const adminRewards = new Hono<AppEnv>();
const admin = requireRole("admin");
const INVALID = "Check the name (1–60 characters), cost (1–100,000), stall and weekly stock (blank or 0–10,000).";

type Row = { id: string; name: string; cost: number; stall_id: string | null; stall_name: string | null; weekly_stock: number | null; active: number; redeemed_this_week: number; pending_now: number };
type Fields = { name?: string; cost?: number; stall_id?: string | null; weekly_stock?: number | null; active?: boolean };

async function list(db: D1Database, id?: string) {
  const now = Date.now();
  const { results } = await db
    .prepare(
      `SELECT w.id, w.name, w.cost, w.stall_id, s.name AS stall_name, w.weekly_stock, w.active,
              (SELECT COUNT(*) FROM redemptions r WHERE r.reward_id = w.id AND r.status = 'redeemed' AND r.redeemed_at >= ?1) AS redeemed_this_week,
              (SELECT COUNT(*) FROM redemptions r WHERE r.reward_id = w.id AND r.status = 'pending' AND r.expires_at > ?2) AS pending_now
       FROM rewards w LEFT JOIN stalls s ON s.id = w.stall_id WHERE (?3 IS NULL OR w.id = ?3) ORDER BY w.cost, w.name`,
    )
    .bind(sgWeekStart(now), now, id ?? null)
    .all<Row>();
  return results.map((r) => ({ ...r, active: r.active === 1 }));
}

/** Validated fields from the body; `creating` makes name and cost required. Null if anything is invalid. */
async function parse(db: D1Database, b: Record<string, unknown>, creating: boolean): Promise<Fields | null> {
  const f: Fields = {};
  if ("name" in b || creating) {
    if (typeof b.name !== "string" || b.name.trim().length < 1 || b.name.trim().length > 60) return null;
    f.name = b.name.trim();
  }
  if ("cost" in b || creating) {
    if (!Number.isInteger(b.cost) || (b.cost as number) < 1 || (b.cost as number) > 100_000) return null;
    f.cost = b.cost as number;
  }
  if ("stall_id" in b) {
    if (b.stall_id === null) f.stall_id = null;
    else if (typeof b.stall_id === "string" && (await db.prepare("SELECT 1 AS x FROM stalls WHERE id = ?").bind(b.stall_id).first())) f.stall_id = b.stall_id;
    else return null;
  }
  if ("weekly_stock" in b) {
    if (b.weekly_stock === null) f.weekly_stock = null;
    else if (Number.isInteger(b.weekly_stock) && (b.weekly_stock as number) >= 0 && (b.weekly_stock as number) <= 10_000) f.weekly_stock = b.weekly_stock as number;
    else return null;
  }
  if ("active" in b) {
    if (typeof b.active !== "boolean") return null;
    f.active = b.active;
  }
  return f;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "reward";

adminRewards.get("/admin/rewards", admin, async (c) => c.json({ rewards: await list(c.env.DB) }));

adminRewards.post("/admin/rewards", admin, async (c) => {
  const db = c.env.DB;
  const f = await parse(db, await readBody(c), true);
  if (!f) return fail(c, 400, "invalid_reward", INVALID);
  const id = `${slug(f.name!)}-${crypto.randomUUID().slice(0, 4)}`;
  await db.prepare("INSERT INTO rewards (id, name, cost, stall_id, weekly_stock, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, f.name, f.cost, f.stall_id ?? null, f.weekly_stock ?? null, f.active === false ? 0 : 1, Date.now()).run();
  return c.json({ reward: (await list(db, id))[0] }, 201);
});

adminRewards.post("/admin/rewards/:id", admin, async (c) => {
  const db = c.env.DB;
  const cur = (await list(db, c.req.param("id")))[0];
  if (!cur) return fail(c, 404, "no_reward", "That reward doesn't exist.");
  const f = await parse(db, await readBody(c), false);
  if (!f) return fail(c, 400, "invalid_reward", INVALID);
  const next = { ...cur, ...f };
  await db.prepare("UPDATE rewards SET name = ?, cost = ?, stall_id = ?, weekly_stock = ?, active = ? WHERE id = ?")
    .bind(next.name, next.cost, next.stall_id, next.weekly_stock, next.active ? 1 : 0, cur.id).run();
  return c.json({ reward: (await list(db, cur.id))[0] });
});

const HEADER = ["redemption_id", "user_id", "reward_id", "reward_name", "cost", "status", "code", "created_at_sgt", "expires_at_sgt", "redeemed_at_sgt", "stall_id", "week_start_sgt"];

adminRewards.get("/admin/redemptions.csv", admin, async (c) => {
  const now = Date.now();
  const { results } = await c.env.DB.prepare(
    `SELECT r.id, r.user_id, r.reward_id, w.name AS reward_name, r.cost, r.status, r.code, r.created_at, r.expires_at, r.redeemed_at, r.stall_id
     FROM redemptions r JOIN rewards w ON w.id = r.reward_id ORDER BY r.created_at`,
  ).all<{ id: string; user_id: string; reward_id: string; reward_name: string; cost: number; status: string; code: string; created_at: number; expires_at: number; redeemed_at: number | null; stall_id: string | null }>();
  const rows = results.map((r) => [
    r.id, r.user_id, r.reward_id, r.reward_name, r.cost,
    r.status === "pending" && r.expires_at <= now ? "expired" : r.status,
    r.code, sgIso(r.created_at), sgIso(r.expires_at), r.redeemed_at != null ? sgIso(r.redeemed_at) : null, r.stall_id, sgDate(sgWeekStart(r.created_at)),
  ]);
  return c.body(toCsv(HEADER, rows), 200, {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="redemptions-${sgDate(now)}.csv"`,
  });
});
