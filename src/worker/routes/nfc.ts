import { Hono } from "hono";
import { award, claimBlocker, loadToken } from "../claims";
import { loadSettings } from "../db";
import type { AppEnv } from "../env";
import { fail, readBody } from "../http";
import { requireRole } from "../session";

export const nfc = new Hono<AppEnv>();
const student = requireRole("student");
const seller = requireRole("seller");

nfc.post("/tap", student, async (c) => {
  const db = c.env.DB;
  const uid = c.get("user")!.id;
  const b = await readBody(c);
  const now = Date.now();
  const stall = typeof b.stall_id === "string"
    ? await db.prepare("SELECT id, verify_method FROM stalls WHERE id = ?").bind(b.stall_id).first<{ id: string; verify_method: string }>()
    : null;
  if (!stall) return fail(c, 404, "no_stall", "This sticker isn't linked to a stall.");
  if (stall.verify_method === "qr") return fail(c, 403, "nfc_off", "This stall uses QR codes. Scan the code on the seller's screen.");
  // A second read of the sticker (phones often fire twice) or a reload returns the student's own pending claim.
  const mine = await db
    .prepare("SELECT id FROM tokens WHERE stall_id = ? AND method = 'nfc' AND used_at IS NULL AND pending_user_id = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1")
    .bind(stall.id, uid, now)
    .first<{ id: string }>();
  if (mine) {
    const own = (await loadToken(db, mine.id))!;
    return c.json({ token_id: own.id, stall_name: own.stall_name, item_name: own.item_name }, 201);
  }
  const pending = await db
    .prepare("SELECT id FROM tokens WHERE stall_id = ? AND method = 'nfc' AND used_at IS NULL AND pending_user_id IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1")
    .bind(stall.id, now)
    .first<{ id: string }>();
  if (!pending) return fail(c, 404, "no_pending", "Ask the seller to tap what you bought first, then tap the sticker again.");
  const tok = (await loadToken(db, pending.id))!;
  const block = await claimBlocker(db, tok, uid, now, await loadSettings(db));
  if (block) return fail(c, ...block);
  const upd = await db.prepare("UPDATE tokens SET pending_user_id = ? WHERE id = ? AND pending_user_id IS NULL AND used_at IS NULL").bind(uid, tok.id).run();
  if (upd.meta.changes !== 1) return fail(c, 409, "taken", "Someone else tapped first. Ask the seller to tap the item again.");
  return c.json({ token_id: tok.id, stall_name: tok.stall_name, item_name: tok.item_name }, 201);
});

nfc.get("/tap/:id", student, async (c) => {
  const db = c.env.DB;
  const uid = c.get("user")!.id;
  const tok = await loadToken(db, c.req.param("id"));
  if (!tok || tok.pending_user_id !== uid) return fail(c, 404, "no_token", "Tap not found.");
  const base = { stall_name: tok.stall_name, item_name: tok.item_name };
  if (tok.used_at != null && tok.used_by === uid) {
    const { results } = await db.prepare("SELECT type, points, kg_co2e FROM activities WHERE token_id = ? AND user_id = ?").bind(tok.id, uid).all<{ type: string; points: number; kg_co2e: number | null }>();
    const low = tok.kind === "meal" && tok.low_carbon === 1;
    return c.json({ state: "confirmed", ...base, result: { item_name: tok.item_name, stall_name: tok.stall_name, kind: tok.kind, low_carbon: low, kg_co2e: tok.kg_co2e, points: results.reduce((n, r) => n + r.points, 0), activities: results } });
  }
  if (tok.used_at != null || Date.now() > tok.expires_at) return c.json({ state: "expired", ...base });
  return c.json({ state: "waiting", ...base });
});

nfc.post("/stall/tokens/:id/confirm", seller, async (c) => {
  const db = c.env.DB;
  const tok = await loadToken(db, c.req.param("id"));
  if (!tok || tok.stall_id !== c.get("user")!.stall_id) return fail(c, 404, "no_token", "Code not found.");
  if (tok.method !== "nfc") return fail(c, 400, "not_nfc", "This code is a QR code; the customer scans it.");
  if (!tok.pending_user_id) return fail(c, 409, "not_tapped", "No one has tapped the sticker yet.");
  const now = Date.now();
  const s = await loadSettings(db);
  const block = await claimBlocker(db, tok, tok.pending_user_id, now, s);
  if (block) return fail(c, ...block);
  const result = await award(db, tok, tok.pending_user_id, now, s, "nfc");
  if (!result) return fail(c, 409, "used", "Already confirmed.");
  const who = await db.prepare("SELECT display_name FROM users WHERE id = ?").bind(tok.pending_user_id).first<string>("display_name");
  return c.json({ claimed_by: who, points: result.points });
});
