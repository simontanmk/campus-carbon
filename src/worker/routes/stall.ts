import { Hono } from "hono";
import { loadSettings } from "../db";
import type { AppEnv } from "../env";
import { fail } from "../http";
import { sign } from "../lib/token";
import { requireRole } from "../session";

export const stall = new Hono<AppEnv>();
const seller = requireRole("seller");

type StallRow = { id: string; name: string; canteen: string; active: number; verify_method: string };

stall.get("/stall", seller, async (c) => {
  const db = c.env.DB;
  const s = await db
    .prepare("SELECT id, name, canteen, active, verify_method FROM stalls WHERE id = ?")
    .bind(c.get("user")!.stall_id)
    .first<StallRow>();
  if (!s) return fail(c, 404, "no_stall", "This seller account isn't linked to a stall.");
  const { results } = await db
    .prepare("SELECT id, name, kind, kg_co2e, low_carbon FROM items WHERE stall_id = ? AND status = 'live' ORDER BY kind DESC, name")
    .bind(s.id)
    .all<{ id: string; name: string; kind: string; kg_co2e: number | null; low_carbon: number }>();
  return c.json({
    stall: { ...s, active: s.active === 1 },
    items: results.map((i) => ({ ...i, low_carbon: i.low_carbon === 1 })),
  });
});

stall.post("/stall/tokens", seller, async (c) => {
  const db = c.env.DB;
  const user = c.get("user")!;
  const body = (await c.req.json().catch(() => ({}))) as { item_id?: unknown; byo?: unknown };
  const item =
    typeof body.item_id === "string"
      ? await db
          .prepare("SELECT i.id, i.stall_id, i.status, s.active FROM items i JOIN stalls s ON s.id = i.stall_id WHERE i.id = ?")
          .bind(body.item_id)
          .first<{ id: string; stall_id: string; status: string; active: number }>()
      : null;
  if (!item || item.status !== "live") return fail(c, 404, "no_item", "That item isn't on the menu.");
  if (item.stall_id !== user.stall_id) return fail(c, 403, "wrong_stall", "That item belongs to another stall.");
  if (item.active !== 1) return fail(c, 403, "stall_inactive", "This stall isn't taking claims right now.");

  const settings = await loadSettings(db);
  const id = crypto.randomUUID();
  const now = Date.now();
  const expires_at = now + settings.token_ttl_sec * 1000;
  await db
    .prepare("INSERT INTO tokens (id, stall_id, item_id, byo, method, created_at, expires_at) VALUES (?, ?, ?, ?, 'qr', ?, ?)")
    .bind(id, item.stall_id, item.id, body.byo === true ? 1 : 0, now, expires_at)
    .run();
  const token = await sign(id, c.env.TOKEN_SECRET);
  const claim_url = `${new URL(c.req.url).origin}/claim?t=${encodeURIComponent(token)}`;
  return c.json({ id, token, claim_url, expires_at }, 201);
});

stall.get("/stall/tokens/:id", seller, async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT t.stall_id, t.expires_at, t.used_at, u.display_name AS claimed_by FROM tokens t LEFT JOIN users u ON u.id = t.used_by WHERE t.id = ?",
  )
    .bind(c.req.param("id"))
    .first<{ stall_id: string; expires_at: number; used_at: number | null; claimed_by: string | null }>();
  if (!row || row.stall_id !== c.get("user")!.stall_id) return fail(c, 404, "no_token", "Code not found.");
  const state = row.used_at != null ? "claimed" : Date.now() > row.expires_at ? "expired" : "pending";
  return c.json({ state, expires_at: row.expires_at, claimed_by: row.claimed_by ?? null });
});
