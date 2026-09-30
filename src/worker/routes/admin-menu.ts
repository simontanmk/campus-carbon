import { Hono } from "hono";
import type { AppEnv } from "../env";
import { fail, readBody } from "../http";
import { decodeImage } from "../image";
import { aiJson } from "../lib/ai";
import { cleanParts, MENU_PROMPT, mockMenu, validateMenu } from "../lib/ai-tasks";
import { computeKg, isLowCarbonMeal, type FactorTable, type Parts } from "../lib/carbon";
import { requireRole } from "../session";

export const adminMenu = new Hono<AppEnv>();
const admin = requireRole("admin");

type ItemRow = { id: string; stall_id: string; name: string; kind: "meal" | "drink"; parts_json: string; kg_co2e: number | null; low_carbon: number; status: string };
const shape = (r: ItemRow) => ({ id: r.id, stall_id: r.stall_id, name: r.name, kind: r.kind, parts: JSON.parse(r.parts_json || "{}"), kg_co2e: r.kg_co2e, low_carbon: r.low_carbon === 1, status: r.status });

async function factorTable(db: D1Database): Promise<FactorTable> {
  const { results } = await db.prepare("SELECT key, kg_per_unit FROM factors WHERE unit = 'kg'").all<{ key: string; kg_per_unit: number | null }>();
  return Object.fromEntries(results.map((r) => [r.key, r.kg_per_unit]));
}
function assess(kind: "meal" | "drink", parts: Parts, f: FactorTable) {
  const kg = Object.keys(parts).length ? computeKg(parts, f) : null;
  return { kg_co2e: kg, low_carbon: kind === "meal" && kg != null && isLowCarbonMeal(parts) ? 1 : 0 };
}
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "item";

adminMenu.get("/admin/stalls", admin, async (c) => {
  const { results } = await c.env.DB.prepare("SELECT id, name, canteen FROM stalls ORDER BY name").all();
  return c.json({ stalls: results });
});

adminMenu.get("/admin/items", admin, async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM items WHERE stall_id = ? ORDER BY status, kind DESC, name").bind(c.req.query("stall_id") ?? "").all<ItemRow>();
  return c.json({ items: results.map(shape) });
});

adminMenu.post("/admin/menu/photo", admin, async (c) => {
  const db = c.env.DB;
  const body = await readBody(c);
  const stall = typeof body.stall_id === "string" ? await db.prepare("SELECT id FROM stalls WHERE id = ?").bind(body.stall_id).first<{ id: string }>() : null;
  if (!stall) return fail(c, 404, "no_stall", "Pick a stall first.");
  const img = await decodeImage(body.image);
  if ("error" in img) return fail(c, 400, "invalid_image", "Take a JPEG, PNG or WebP photo under 1.5 MB.");
  const r = await aiJson(c.env, { instructions: MENU_PROMPT, text: "List this stall's menu.", image: { mime: img.mime, base64: img.base64 } }, validateMenu, mockMenu, c.env.AI_FETCH);
  const f = await factorTable(db);
  const rows = r.value.items.map((i) => ({ id: `${stall.id}-${slug(i.name)}-${crypto.randomUUID().slice(0, 4)}`, stall_id: stall.id, name: i.name, kind: i.kind, parts_json: JSON.stringify(i.parts), ...assess(i.kind, i.parts, f), status: "draft" }));
  await db.batch(rows.map((x) => db.prepare("INSERT INTO items (id, stall_id, name, kind, parts_json, kg_co2e, low_carbon, points, status) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'draft')").bind(x.id, x.stall_id, x.name, x.kind, x.parts_json, x.kg_co2e, x.low_carbon)));
  return c.json({ items: rows.map((x) => shape(x as ItemRow)), source: r.source }, 201);
});

adminMenu.post("/admin/items/:id", admin, async (c) => {
  const db = c.env.DB;
  const cur = await db.prepare("SELECT * FROM items WHERE id = ?").bind(c.req.param("id")).first<ItemRow>();
  if (!cur) return fail(c, 404, "no_item", "That item doesn't exist.");
  const b = await readBody(c);
  const bad =
    ("name" in b && (typeof b.name !== "string" || b.name.trim().length < 1 || b.name.trim().length > 80)) ||
    ("kind" in b && b.kind !== "meal" && b.kind !== "drink") ||
    ("status" in b && b.status !== "draft" && b.status !== "live") ||
    ("parts" in b && (!b.parts || typeof b.parts !== "object" || Array.isArray(b.parts)));
  if (bad) return fail(c, 400, "invalid_item", "Check the name, kind, ingredients and status.");
  const name = "name" in b ? (b.name as string).trim() : cur.name;
  const kind = ("kind" in b ? b.kind : cur.kind) as "meal" | "drink";
  const parts = "parts" in b ? cleanParts(b.parts) : (JSON.parse(cur.parts_json || "{}") as Parts);
  const status = ("status" in b ? b.status : cur.status) as string;
  const a = "parts" in b || "kind" in b ? assess(kind, parts, await factorTable(db)) : { kg_co2e: cur.kg_co2e, low_carbon: cur.low_carbon };
  await db.prepare("UPDATE items SET name = ?, kind = ?, parts_json = ?, kg_co2e = ?, low_carbon = ?, status = ? WHERE id = ?")
    .bind(name, kind, JSON.stringify(parts), a.kg_co2e, a.low_carbon, status, cur.id).run();
  return c.json({ item: shape({ ...cur, name, kind, parts_json: JSON.stringify(parts), kg_co2e: a.kg_co2e, low_carbon: a.low_carbon, status }) });
});

adminMenu.post("/admin/items/:id/delete", admin, async (c) => {
  const db = c.env.DB;
  const cur = await db.prepare("SELECT status FROM items WHERE id = ?").bind(c.req.param("id")).first<{ status: string }>();
  if (!cur) return fail(c, 404, "no_item", "That item doesn't exist.");
  if (cur.status !== "draft") return fail(c, 409, "not_draft", "Only drafts can be deleted. Set it back to draft first.");
  await db.prepare("DELETE FROM items WHERE id = ? AND status = 'draft'").bind(c.req.param("id")).run();
  return c.json({ deleted: true });
});
