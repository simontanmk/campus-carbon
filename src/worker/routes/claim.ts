import { Hono } from "hono";
import { insertActivity } from "../activities";
import { loadSettings } from "../db";
import type { AppEnv } from "../env";
import { fail } from "../http";
import { byoPoints, stallClaimPoints } from "../lib/scoring";
import { sgDayStart } from "../lib/time";
import { verify } from "../lib/token";

export const claim = new Hono<AppEnv>();

type TokenRow = {
  id: string;
  stall_id: string;
  item_id: string;
  byo: number;
  method: string;
  expires_at: number;
  used_at: number | null;
  item_name: string;
  kind: "meal" | "drink";
  kg_co2e: number | null;
  low_carbon: number;
  item_points: number | null;
  stall_name: string;
  active: number;
};

const INVALID = "This code isn't valid. Ask the stall for a new one.";

claim.post("/claim", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  if (!user) return fail(c, 401, "no_session", "Enter a display name first.");
  if (user.role !== "student") return fail(c, 403, "not_student", "Seller and admin accounts can't claim points.");

  const body = (await c.req.json().catch(() => ({}))) as { t?: unknown };
  const id = await verify(body.t, c.env.TOKEN_SECRET);
  if (!id) return fail(c, 400, "invalid_token", INVALID);

  const tok = await db
    .prepare(
      `SELECT t.id, t.stall_id, t.item_id, t.byo, t.method, t.expires_at, t.used_at,
              i.name AS item_name, i.kind, i.kg_co2e, i.low_carbon, i.points AS item_points,
              s.name AS stall_name, s.active
       FROM tokens t JOIN items i ON i.id = t.item_id JOIN stalls s ON s.id = t.stall_id
       WHERE t.id = ?`,
    )
    .bind(id)
    .first<TokenRow>();
  if (!tok || tok.method !== "qr") return fail(c, 400, "invalid_token", INVALID);
  if (tok.used_at != null) return fail(c, 409, "used", "This code has already been used.");
  const now = Date.now();
  if (now > tok.expires_at) return fail(c, 410, "expired", "This code has expired. Ask the stall for a new one.");
  if (tok.active !== 1) return fail(c, 403, "stall_inactive", "This stall isn't taking claims right now.");

  const s = await loadSettings(db);
  const recent = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM activities WHERE user_id = ? AND stall_id = ? AND type IN ('meal','drink') AND verified = 1 AND created_at > ?",
    )
    .bind(user.id, tok.stall_id, now - s.rate_stall_window_min * 60_000)
    .first<number>("n");
  if ((recent ?? 0) > 0) {
    return fail(c, 429, "rate_limited", `You can claim at this stall once every ${s.rate_stall_window_min} minutes.`);
  }
  const today = await db
    .prepare("SELECT COUNT(*) AS n FROM activities WHERE user_id = ? AND type IN ('meal','drink') AND verified = 1 AND created_at >= ?")
    .bind(user.id, sgDayStart(now))
    .first<number>("n");
  if ((today ?? 0) >= s.rate_daily_max) {
    return fail(c, 429, "daily_limit", `You've reached today's limit of ${s.rate_daily_max} claims.`);
  }

  const upd = await db
    .prepare("UPDATE tokens SET used_at = ?, used_by = ? WHERE id = ? AND used_at IS NULL")
    .bind(now, user.id, tok.id)
    .run();
  if (upd.meta.changes !== 1) return fail(c, 409, "used", "This code has already been used.");

  const low = tok.kind === "meal" && tok.low_carbon === 1;
  const mainPoints = stallClaimPoints({ kind: tok.kind, low_carbon: low, points: tok.item_points }, s);
  const base = { user_id: user.id, verified: true, source: "qr" as const, token_id: tok.id, stall_id: tok.stall_id, created_at: now };
  const stmts = [
    insertActivity(db, {
      ...base,
      category: "food",
      type: tok.kind,
      kg_co2e: tok.kg_co2e,
      points: mainPoints,
      item_id: tok.item_id,
      low_carbon: tok.kind === "meal" ? low : null,
    }),
  ];
  const activities = [{ type: tok.kind as string, points: mainPoints, kg_co2e: tok.kg_co2e }];
  if (tok.byo === 1) {
    const p = byoPoints(s);
    stmts.push(insertActivity(db, { ...base, category: "waste", type: "byo", kg_co2e: null, points: p }));
    activities.push({ type: "byo", points: p, kg_co2e: null });
  }
  await db.batch(stmts);

  return c.json({
    item_name: tok.item_name,
    stall_name: tok.stall_name,
    kind: tok.kind,
    low_carbon: low,
    kg_co2e: tok.kg_co2e,
    points: activities.reduce((n, a) => n + a.points, 0),
    activities,
  });
});
