import { describe, expect, it, vi } from "vitest";
import { setup } from "./helpers/setup";

const HOUR = 3_600_000;
const sgMinute = (ms: number) => new Date(ms + 8 * HOUR).toISOString().slice(0, 16).replace("T", " ");

// Distinct images (decodeImage checks only the PNG signature), so each upload has its own hash.
let n = 0;
const png = () => ({ mime: "image/png", base64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, n++, 1, 2, 3]).toString("base64") });

const reply = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ is_bcrs_refund: true, provider: "paylah", amount_cents: 30, refunded_at: sgMinute(Date.now() - HOUR), ...over });

/** A live AI that answers each call with the next reply in `answers` (the last one repeats). */
function live(...answers: string[]) {
  let i = 0;
  return {
    AI_MODE: "live", AI_BASE_URL: "https://ai.test/v1", AI_MODEL: "m", AI_API_KEY: "k",
    AI_FETCH: vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: answers[Math.min(i++, answers.length - 1)] } }] }), { status: 200 })),
  };
}

async function student(ctx: Awaited<ReturnType<typeof setup>>, name = "Bottle") {
  const uid = (await ctx.req("/api/session", { body: { display_name: name } })).body.user.id as string;
  ctx.raw.exec(`UPDATE users SET created_at = ${Date.now() - 2 * 24 * HOUR} WHERE id = '${uid}'`);
  return uid;
}
const upload = (ctx: Awaited<ReturnType<typeof setup>>, uid: string, image = png()) => ctx.req("/api/returns/receipt", { as: uid, body: { image } });

describe("POST /api/returns/receipt", () => {
  it("logs the containers the refund pays for, as a receipt-backed return", async () => {
    const ctx = await setup(live(reply()));
    const uid = await student(ctx);
    const res = await upload(ctx, uid);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ points: 15, capped: false, containers: 3, provider: "paylah" });
    expect(res.body.refunded_at).toMatch(/\+08:00$/);
    const row = ctx.raw.prepare("SELECT * FROM activities WHERE user_id = ?").get(uid) as any;
    expect(row).toMatchObject({ category: "waste", type: "container_return", verified: 0, source: "receipt", kg_co2e: null, points: 15 });
    expect(row.image_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.receipt_key).toMatch(/^paylah:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:30$/);
    expect(JSON.parse(row.detail_json)).toMatchObject({ count: 3, provider: "paylah", amount_cents: 30, ai: "live" });
  });

  it("uses one of the student's AI calls", async () => {
    const ctx = await setup(live(reply()));
    const uid = await student(ctx);
    await upload(ctx, uid);
    expect((ctx.raw.prepare("SELECT COUNT(*) AS n FROM ai_calls WHERE user_id = ?").get(uid) as any).n).toBe(1);
  });

  it("refuses when the AI is offline, logging nothing", async () => {
    const ctx = await setup();
    const uid = await student(ctx);
    const res = await upload(ctx, uid);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("receipt_unavailable");
    expect(ctx.raw.prepare("SELECT COUNT(*) AS n FROM activities WHERE user_id = ?").get(uid)).toEqual({ n: 0 });
  });

  it("refuses when the AI fails, logging nothing", async () => {
    const ctx = await setup(live("not json"));
    const uid = await student(ctx);
    expect((await upload(ctx, uid)).body.error).toBe("receipt_unavailable");
  });

  it.each([
    ["not_receipt", 422, { is_bcrs_refund: false }],
    ["bad_amount", 422, { amount_cents: 35 }],
    ["receipt_date", 422, { refunded_at: sgMinute(Date.now() - 4 * 24 * HOUR) }],
  ])("%s", async (code, status, over) => {
    const ctx = await setup(live(reply(over)));
    const uid = await student(ctx);
    const res = await upload(ctx, uid);
    expect(res.status).toBe(status);
    expect(res.body.error).toBe(code);
  });

  it("refuses a refund from before the student joined", async () => {
    const ctx = await setup(live(reply()));
    const uid = (await ctx.req("/api/session", { body: { display_name: "New" } })).body.user.id as string;
    const res = await upload(ctx, uid);
    expect(res.body).toMatchObject({ error: "receipt_date", message: "That refund is from before you joined." });
  });

  it("refuses the same screenshot twice", async () => {
    const ctx = await setup(live(reply(), reply({ refunded_at: sgMinute(Date.now() - 2 * HOUR) })));
    const uid = await student(ctx);
    const image = png();
    expect((await upload(ctx, uid, image)).status).toBe(201);
    const again = await upload(ctx, uid, image);
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("duplicate_photo");
  });

  it("refuses the same refund through another screenshot, even from another student", async () => {
    const ctx = await setup(live(reply()));
    const a = await student(ctx, "A");
    const b = await student(ctx, "B");
    expect((await upload(ctx, a)).status).toBe(201);
    const res = await upload(ctx, b);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "receipt_claimed", message: "This refund has already been claimed." });
  });

  it("caps receipt points at 50 a day, separately from the 30-point self-reported cap", async () => {
    const at = (h: number) => reply({ amount_cents: 80, refunded_at: sgMinute(Date.now() - h * HOUR) });
    const ctx = await setup(live(at(1), at(2)));
    const uid = await student(ctx);
    // Use up the self-reported cap with walk trips first.
    for (let i = 0; i < 3; i++) await ctx.req("/api/trips", { as: uid, body: { from_id: "hive", to_id: "north-spine", mode: "walk" } });
    expect((await upload(ctx, uid)).body).toMatchObject({ points: 40, capped: false, containers: 8 });
    expect((await upload(ctx, uid)).body).toMatchObject({ points: 10, capped: true, containers: 8 });
    // And receipts don't use up the self-reported cap.
    const ctx2 = await setup(live(reply({ amount_cents: 100 })));
    const uid2 = await student(ctx2);
    await upload(ctx2, uid2);
    expect((await ctx2.req("/api/trips", { as: uid2, body: { from_id: "hive", to_id: "north-spine", mode: "walk" } })).body).toMatchObject({ points: 10, capped: false });
  });

  it("follows the receipt_daily_cap setting", async () => {
    const ctx = await setup(live(reply({ amount_cents: 100 })));
    ctx.raw.exec("INSERT INTO settings (key, value) VALUES ('receipt_daily_cap', '20') ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    const uid = await student(ctx);
    expect((await upload(ctx, uid)).body).toMatchObject({ points: 20, capped: true });
  });

  it("rejects an invalid image before calling the AI", async () => {
    const env = live(reply());
    const ctx = await setup(env);
    const uid = await student(ctx);
    const res = await upload(ctx, uid, { mime: "image/png", base64: Buffer.from("hello").toString("base64") });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_image");
    expect(env.AI_FETCH).not.toHaveBeenCalled();
  });

  it("is student-only", async () => {
    const ctx = await setup(live(reply()));
    expect((await upload(ctx, "u-seller-econ")).status).toBe(403);
  });

  it("no longer accepts a typed count", async () => {
    const ctx = await setup();
    const uid = await student(ctx);
    expect((await ctx.req("/api/returns", { as: uid, body: { count: 3 } })).status).toBe(404);
  });
});
