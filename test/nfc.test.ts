import { describe, expect, it } from "vitest";
import { setup as baseSetup } from "./helpers/setup";

async function setup() {
  const ctx = await baseSetup();
  ctx.raw.exec("DELETE FROM activities WHERE id LIKE 'seed-%'"); // keep rate limits independent of persona history
  return ctx;
}
async function student(ctx: Awaited<ReturnType<typeof setup>>, name = "Tapper") {
  return (await ctx.req("/api/session", { body: { display_name: name } })).body.user.id as string;
}
const nfcToken = (ctx: any, item_id = "veg-noodles", byo = false) =>
  ctx.req("/api/stall/tokens", { as: "u-seller-noodles", body: { item_id, byo, method: "nfc" } });

describe("NFC token creation", () => {
  it("is refused at a QR-only stall", async () => {
    const ctx = await setup();
    const res = await ctx.req("/api/stall/tokens", { as: "u-seller-econ", body: { item_id: "econ-veg-egg", method: "nfc" } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("method_off");
  });

  it("a new NFC token expires the stall's previous pending one", async () => {
    const ctx = await setup();
    const first = (await nfcToken(ctx)).body;
    await nfcToken(ctx, "wanton-mee");
    expect((await ctx.req(`/api/stall/tokens/${first.id}`, { as: "u-seller-noodles" })).body.state).toBe("expired");
  });

  it("QR stays the default and is refused at an NFC-only stall", async () => {
    const ctx = await setup();
    ctx.raw.exec("UPDATE stalls SET verify_method='nfc' WHERE id='noodles'");
    const res = await ctx.req("/api/stall/tokens", { as: "u-seller-noodles", body: { item_id: "veg-noodles" } });
    expect(res.body.error).toBe("method_off");
  });
});

describe("tap → seller confirm", () => {
  it("records nothing until the seller confirms, then awards like QR with source nfc", async () => {
    const ctx = await setup();
    const uid = await student(ctx);
    const t = (await nfcToken(ctx, "veg-noodles", true)).body;
    const tap = await ctx.req("/api/tap", { as: uid, body: { stall_id: "noodles" } });
    expect(tap.status).toBe(201);
    expect(tap.body).toEqual({ token_id: t.id, stall_name: "Noodles & Rice Plates", item_name: "Vegetarian noodles with tofu" });
    expect((ctx.raw.prepare("SELECT COUNT(*) AS n FROM activities WHERE user_id=?").get(uid) as any).n).toBe(0);
    expect((await ctx.req(`/api/tap/${t.id}`, { as: uid })).body.state).toBe("waiting");

    const status = (await ctx.req(`/api/stall/tokens/${t.id}`, { as: "u-seller-noodles" })).body;
    expect(status).toMatchObject({ state: "tapped", pending_name: "Tapper" });

    const conf = await ctx.req(`/api/stall/tokens/${t.id}/confirm`, { as: "u-seller-noodles", body: {} });
    expect(conf.status).toBe(200);
    expect(conf.body).toEqual({ claimed_by: "Tapper", points: 35 });
    const rows = ctx.raw.prepare("SELECT type, verified, source FROM activities WHERE user_id=? ORDER BY type DESC").all(uid);
    expect(rows).toEqual([{ type: "meal", verified: 1, source: "nfc" }, { type: "byo", verified: 1, source: "nfc" }]);
    expect((ctx.raw.prepare("SELECT confirmed_at FROM tokens WHERE id=?").get(t.id) as any).confirmed_at).not.toBeNull();

    const done = (await ctx.req(`/api/tap/${t.id}`, { as: uid })).body;
    expect(done).toMatchObject({ state: "confirmed", result: { points: 35, low_carbon: true, item_name: "Vegetarian noodles with tofu" } });
  });

  it("tapping twice (or reloading /tap) returns the same pending claim", async () => {
    const ctx = await setup();
    const uid = await student(ctx);
    const t = (await nfcToken(ctx)).body;
    const first = await ctx.req("/api/tap", { as: uid, body: { stall_id: "noodles" } });
    const again = await ctx.req("/api/tap", { as: uid, body: { stall_id: "noodles" } });
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(again.body.token_id).toBe(t.id);
  });

  it("a second student finds nothing pending once someone has tapped", async () => {
    const ctx = await setup();
    const a = await student(ctx, "First");
    const b = await student(ctx, "Second");
    await nfcToken(ctx);
    expect((await ctx.req("/api/tap", { as: a, body: { stall_id: "noodles" } })).status).toBe(201);
    const second = await ctx.req("/api/tap", { as: b, body: { stall_id: "noodles" } });
    expect(second.status).toBe(404);
    expect(second.body.error).toBe("no_pending");
  });

  it("confirming twice awards once", async () => {
    const ctx = await setup();
    const uid = await student(ctx);
    const t = (await nfcToken(ctx)).body;
    await ctx.req("/api/tap", { as: uid, body: { stall_id: "noodles" } });
    const results = await Promise.all([
      ctx.req(`/api/stall/tokens/${t.id}/confirm`, { as: "u-seller-noodles", body: {} }),
      ctx.req(`/api/stall/tokens/${t.id}/confirm`, { as: "u-seller-noodles", body: {} }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((ctx.raw.prepare("SELECT COUNT(*) AS n FROM activities WHERE token_id=?").get(t.id) as any).n).toBe(1);
  });

  it.each([
    ["nothing pending", async (ctx: any) => {}, "noodles", 404, "no_pending"],
    ["QR-only stall", async (ctx: any) => {}, "econ-rice", 403, "nfc_off"],
    ["unknown stall", async (ctx: any) => {}, "nope", 404, "no_stall"],
    ["expired token", async (ctx: any) => { const t = (await nfcToken(ctx)).body; ctx.raw.exec(`UPDATE tokens SET expires_at=0 WHERE id='${t.id}'`); }, "noodles", 404, "no_pending"],
  ])("tap with %s → %i %s", async (_n, prep, stall_id, status, error) => {
    const ctx = await setup();
    const uid = await student(ctx);
    await prep(ctx);
    const res = await ctx.req("/api/tap", { as: uid, body: { stall_id } });
    expect(res.status).toBe(status);
    expect(res.body.error).toBe(error);
  });

  it("applies the per-stall rate limit at tap time", async () => {
    const ctx = await setup();
    const uid = await student(ctx);
    ctx.raw.exec(`INSERT INTO activities (id,user_id,category,type,points,verified,source,stall_id,created_at) VALUES ('r','${uid}','food','meal',0,1,'qr','noodles',${Date.now() - 60_000})`);
    await nfcToken(ctx);
    const res = await ctx.req("/api/tap", { as: uid, body: { stall_id: "noodles" } });
    expect(res.status).toBe(429);
    expect(res.body.error).toBe("rate_limited");
  });

  it("sellers can't tap; confirm before a tap, of another stall's token, or of a QR token is refused", async () => {
    const ctx = await setup();
    expect((await ctx.req("/api/tap", { as: "u-seller-noodles", body: { stall_id: "noodles" } })).status).toBe(403);
    const t = (await nfcToken(ctx)).body;
    expect((await ctx.req(`/api/stall/tokens/${t.id}/confirm`, { as: "u-seller-noodles", body: {} })).body.error).toBe("not_tapped");
    expect((await ctx.req(`/api/stall/tokens/${t.id}/confirm`, { as: "u-seller-econ", body: {} })).status).toBe(404);
    const qr = (await ctx.req("/api/stall/tokens", { as: "u-seller-noodles", body: { item_id: "veg-noodles" } })).body;
    expect((await ctx.req(`/api/stall/tokens/${qr.id}/confirm`, { as: "u-seller-noodles", body: {} })).body.error).toBe("not_nfc");
  });

  it("an NFC token can't be claimed through the QR route", async () => {
    const ctx = await setup();
    const uid = await student(ctx);
    const t = (await nfcToken(ctx)).body;
    const res = await ctx.req("/api/claim", { as: uid, body: { t: t.token } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_token");
  });

  it("only the tapping student can read the tap status", async () => {
    const ctx = await setup();
    const a = await student(ctx, "A");
    const b = await student(ctx, "B");
    const t = (await nfcToken(ctx)).body;
    await ctx.req("/api/tap", { as: a, body: { stall_id: "noodles" } });
    expect((await ctx.req(`/api/tap/${t.id}`, { as: b })).status).toBe(404);
  });
});
