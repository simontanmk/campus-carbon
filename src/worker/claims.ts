import type { ContentfulStatusCode } from "hono/utils/http-status";
import { insertActivity } from "./activities";
import { byoPoints, stallClaimPoints } from "./lib/scoring";
import type { Settings } from "./lib/settings";
import { sgDayStart } from "./lib/time";

export type TokenRow = {
  id: string; stall_id: string; item_id: string; byo: number; method: string;
  created_at: number; expires_at: number; used_at: number | null; used_by: string | null; pending_user_id: string | null;
  item_name: string; kind: "meal" | "drink"; kg_co2e: number | null; low_carbon: number; item_points: number | null;
  stall_name: string; active: number;
};
export type Blocker = readonly [ContentfulStatusCode, string, string];
export type ClaimResult = {
  item_name: string; stall_name: string; kind: "meal" | "drink"; low_carbon: boolean; kg_co2e: number | null; points: number;
  activities: { type: string; points: number; kg_co2e: number | null }[];
};

export function loadToken(db: D1Database, id: string): Promise<TokenRow | null> {
  return db
    .prepare(
      `SELECT t.id, t.stall_id, t.item_id, t.byo, t.method, t.created_at, t.expires_at, t.used_at, t.used_by, t.pending_user_id,
              i.name AS item_name, i.kind, i.kg_co2e, i.low_carbon, i.points AS item_points,
              s.name AS stall_name, s.active
       FROM tokens t JOIN items i ON i.id = t.item_id JOIN stalls s ON s.id = t.stall_id
       WHERE t.id = ?`,
    )
    .bind(id)
    .first<TokenRow>();
}

/** Why this student can't claim this token now, or null. Same order and wording as the Stage 1 QR claim. */
export async function claimBlocker(db: D1Database, tok: TokenRow, userId: string, now: number, s: Settings): Promise<Blocker | null> {
  if (tok.used_at != null) return [409, "used", "This code has already been used."];
  if (now > tok.expires_at) return [410, "expired", "This code has expired. Ask the stall for a new one."];
  if (tok.active !== 1) return [403, "stall_inactive", "This stall isn't taking claims right now."];
  const recent = await db
    .prepare("SELECT COUNT(*) AS n FROM activities WHERE user_id = ? AND stall_id = ? AND type IN ('meal','drink') AND verified = 1 AND created_at > ?")
    .bind(userId, tok.stall_id, now - s.rate_stall_window_min * 60_000)
    .first<number>("n");
  if ((recent ?? 0) > 0) return [429, "rate_limited", `You can claim at this stall once every ${s.rate_stall_window_min} minutes.`];
  const today = await db
    .prepare("SELECT COUNT(*) AS n FROM activities WHERE user_id = ? AND type IN ('meal','drink') AND verified = 1 AND created_at >= ?")
    .bind(userId, sgDayStart(now))
    .first<number>("n");
  if ((today ?? 0) >= s.rate_daily_max) return [429, "daily_limit", `You've reached today's limit of ${s.rate_daily_max} claims.`];
  return null;
}

/** Marks the token used (exactly one winner) and records the verified activities. Null if someone else won. */
export async function award(db: D1Database, tok: TokenRow, userId: string, now: number, s: Settings, source: "qr" | "nfc"): Promise<ClaimResult | null> {
  const upd = await db
    .prepare("UPDATE tokens SET used_at = ?1, used_by = ?2, confirmed_at = CASE WHEN method = 'nfc' THEN ?1 ELSE confirmed_at END WHERE id = ?3 AND used_at IS NULL")
    .bind(now, userId, tok.id)
    .run();
  if (upd.meta.changes !== 1) return null;

  const low = tok.kind === "meal" && tok.low_carbon === 1;
  const mainPoints = stallClaimPoints({ kind: tok.kind, low_carbon: low, points: tok.item_points }, s);
  const base = { user_id: userId, verified: true, source, token_id: tok.id, stall_id: tok.stall_id, created_at: now };
  const stmts = [insertActivity(db, { ...base, category: "food", type: tok.kind, kg_co2e: tok.kg_co2e, points: mainPoints, item_id: tok.item_id, low_carbon: tok.kind === "meal" ? low : null })];
  const activities = [{ type: tok.kind as string, points: mainPoints, kg_co2e: tok.kg_co2e }];
  if (tok.byo === 1) {
    const p = byoPoints(s);
    stmts.push(insertActivity(db, { ...base, category: "waste", type: "byo", kg_co2e: null, points: p }));
    activities.push({ type: "byo", points: p, kg_co2e: null });
  }
  try {
    await db.batch(stmts);
  } catch (err) {
    // Release the token so the student can try again instead of hitting "already used".
    await db.prepare("UPDATE tokens SET used_at = NULL, used_by = NULL, confirmed_at = NULL WHERE id = ? AND used_by = ?").bind(tok.id, userId).run();
    throw err;
  }
  return {
    item_name: tok.item_name, stall_name: tok.stall_name, kind: tok.kind, low_carbon: low, kg_co2e: tok.kg_co2e,
    points: activities.reduce((n, a) => n + a.points, 0), activities,
  };
}
