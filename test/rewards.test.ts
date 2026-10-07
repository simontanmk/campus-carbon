import { describe, expect, it } from "vitest";
import { earnedPoints } from "../src/worker/points";
import { setup } from "./helpers/setup";

describe("earnedPoints", () => {
  it("equals Today's lifetime points, mission bonuses included", async () => {
    const ctx = await setup(); // seeded personas have history with mission bonuses
    for (const uid of ["u-alex", "u-bea", "u-chen"]) {
      const today = (await ctx.req("/api/me/summary", { as: uid })).body.points_total;
      expect(today).toBeGreaterThan(0);
      expect(await earnedPoints(ctx.env.DB, uid)).toBe(today);
    }
  });
});

type Ctx = Awaited<ReturnType<typeof setup>>;
let g = 0;
async function fresh() {
  const ctx = await setup();
  ctx.raw.exec("DELETE FROM activities WHERE id LIKE 'seed-%'");
  return ctx;
}
function give(ctx: Ctx, uid: string, pts: number) {
  // container_return feeds no mission, so earned == pts exactly
  ctx.raw.exec(`INSERT INTO activities (id,user_id,category,type,points,verified,source,detail_json,created_at)
    VALUES ('g${g++}','${uid}','waste','container_return',${pts},0,'manual','{"count":1}',${Date.now() - 1000})`);
}
async function student(ctx: Ctx, points: number, name = "Simon Tan") {
  const uid = (await ctx.req("/api/session", { body: { display_name: name } })).body.user.id as string;
  if (points) give(ctx, uid, points);
  return uid;
}
const redeem = (ctx: Ctx, uid: string, rid: string) => ctx.req(`/api/rewards/${rid}/redeem`, { as: uid, body: {} });
const confirm = (ctx: Ctx, seller: string, code: unknown) => ctx.req("/api/stall/redeem", { as: seller, body: { code } });
const pendingRows = (ctx: Ctx, uid: string) => (ctx.raw.prepare("SELECT COUNT(*) AS n FROM redemptions WHERE user_id=? AND status='pending'").get(uid) as any).n;

describe("GET /api/rewards", () => {
  it("lists active rewards by cost with balance and affordability", async () => {
    const ctx = await fresh();
    const uid = await student(ctx, 160);
    const b = (await ctx.req("/api/rewards", { as: uid })).body;
    expect(b).toMatchObject({ balance: 160, earned: 160, spent: 0, active: null, history: [] });
    expect(b.rewards.map((r: any) => [r.id, r.cost, r.affordable])).toEqual([["egg-addon", 80, true], ["free-kopi", 150, true], ["dollar-off-low", 200, false]]);
    expect(b.rewards.find((r: any) => r.id === "free-kopi")).toMatchObject({ stall_name: "Drinks", left_this_week: 20 });
    expect(b.rewards.find((r: any) => r.id === "dollar-off-low").stall_name).toBeNull();
  });

  it("is for students only", async () => {
    const ctx = await fresh();
    expect((await ctx.req("/api/rewards", { as: "u-seller-drinks" })).status).toBe(403);
  });
});

describe("issuing a code", () => {
  it("puts the cost on hold for 10 minutes", async () => {
    const ctx = await fresh();
    const uid = await student(ctx, 160);
    const r = await redeem(ctx, uid, "free-kopi");
    expect(r.status).toBe(201);
    expect(r.body.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    expect(r.body.expires_at - r.body.server_now).toBe(600_000);
    const b = (await ctx.req("/api/rewards", { as: uid })).body;
    expect(b).toMatchObject({ balance: 10, spent: 150 });
    expect(b.active).toMatchObject({ id: r.body.id, code: r.body.code, reward_name: "Free kopi", cost: 150 });
  });

  it("refuses when points are short, saying how many more", async () => {
    const ctx = await fresh();
    const uid = await student(ctx, 100);
    const r = await redeem(ctx, uid, "dollar-off-low");
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ error: "insufficient", message: "You need 100 more points." });
    expect(pendingRows(ctx, uid)).toBe(0);
  });

  it("allows one live code at a time, even with two taps at once", async () => {
    const ctx = await fresh();
    const uid = await student(ctx, 1000);
    const [a, b] = await Promise.all([redeem(ctx, uid, "egg-addon"), redeem(ctx, uid, "egg-addon")]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(pendingRows(ctx, uid)).toBe(1);
    const third = await redeem(ctx, uid, "free-kopi");
    expect(third.status).toBe(409);
    expect(third.body.error).toBe("already_pending");
  });

  it("never lets the balance go below zero", async () => {
    const ctx = await fresh();
    const uid = await student(ctx, 160);
    const r = await redeem(ctx, uid, "free-kopi");
    expect((await confirm(ctx, "u-seller-drinks", r.body.code)).status).toBe(200);
    const again = await redeem(ctx, uid, "egg-addon");
    expect(again.body.error).toBe("insufficient");
    expect((await ctx.req("/api/rewards", { as: uid })).body.balance).toBe(10);
  });

  it("holds weekly stock when two students race for the last one", async () => {
    const ctx = await fresh();
    ctx.raw.exec("UPDATE rewards SET weekly_stock = 1 WHERE id = 'free-kopi'");
    const a = await student(ctx, 200, "Ana");
    const b = await student(ctx, 200, "Ben");
    const res = await Promise.all([redeem(ctx, a, "free-kopi"), redeem(ctx, b, "free-kopi")]);
    expect(res.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(res.find((r) => r.status === 409)!.body.error).toBe("out_of_stock");
    const c = await student(ctx, 200, "Cai");
    expect((await ctx.req("/api/rewards", { as: c })).body.rewards.find((r: any) => r.id === "free-kopi").left_this_week).toBe(0);
  });

  it("a lapsed hold frees the points, and a new code can be issued", async () => {
    const ctx = await fresh();
    const uid = await student(ctx, 160);
    await redeem(ctx, uid, "free-kopi");
    ctx.raw.exec(`UPDATE redemptions SET expires_at = ${Date.now() - 1}`); // still 'pending' in the table
    const b = (await ctx.req("/api/rewards", { as: uid })).body;
    expect(b).toMatchObject({ balance: 160, active: null });
    expect((await redeem(ctx, uid, "free-kopi")).status).toBe(201);
  });

  it("cancel frees the points at once; only the owner can see or cancel", async () => {
    const ctx = await fresh();
    const uid = await student(ctx, 160);
    const other = await student(ctx, 0, "Other");
    const r = await redeem(ctx, uid, "free-kopi");
    expect((await ctx.req(`/api/rewards/redemptions/${r.body.id}`, { as: other })).status).toBe(404);
    expect((await ctx.req(`/api/rewards/redemptions/${r.body.id}/cancel`, { as: other, body: {} })).status).toBe(409);
    expect((await ctx.req(`/api/rewards/redemptions/${r.body.id}/cancel`, { as: uid, body: {} })).body).toEqual({ cancelled: true });
    expect((await ctx.req("/api/rewards", { as: uid })).body.balance).toBe(160);
    expect((await ctx.req(`/api/rewards/redemptions/${r.body.id}`, { as: uid })).body).toEqual({ status: "expired" });
    expect((await ctx.req(`/api/rewards/redemptions/${r.body.id}/cancel`, { as: uid, body: {} })).body.error).toBe("not_pending");
  });

  it("404 for an unknown or switched-off reward", async () => {
    const ctx = await fresh();
    const uid = await student(ctx, 500);
    expect((await redeem(ctx, uid, "nope")).body.error).toBe("no_reward");
    ctx.raw.exec("UPDATE rewards SET active = 0 WHERE id = 'egg-addon'");
    expect((await redeem(ctx, uid, "egg-addon")).body.error).toBe("no_reward");
  });
});

describe("seller confirms", () => {
  it("at the right stall: redeemed; the student sees it in history", async () => {
    const ctx = await fresh();
    const uid = await student(ctx, 160);
    const r = await redeem(ctx, uid, "free-kopi");
    const typed = `${r.body.code.slice(0, 3)}-${r.body.code.slice(3)}`.toLowerCase();
    const c = await confirm(ctx, "u-seller-drinks", typed);
    expect(c.status).toBe(200);
    expect(c.body).toEqual({ reward_name: "Free kopi", student_name: "Simon", cost: 150 });
    expect((await ctx.req(`/api/rewards/redemptions/${r.body.id}`, { as: uid })).body).toEqual({ status: "redeemed" });
    const b = (await ctx.req("/api/rewards", { as: uid })).body;
    expect(b).toMatchObject({ balance: 10, active: null });
    expect(b.history[0]).toMatchObject({ reward_name: "Free kopi", cost: 150, stall_name: "Drinks" });
  });

  it("an any-stall reward can be confirmed at any stall", async () => {
    const ctx = await fresh();
    const uid = await student(ctx, 200);
    const r = await redeem(ctx, uid, "dollar-off-low");
    expect((await confirm(ctx, "u-seller-noodles", r.body.code)).status).toBe(200);
  });

  it("the wrong stall gets 403 naming the right one, and the code still works there", async () => {
    const ctx = await fresh();
    const uid = await student(ctx, 160);
    const r = await redeem(ctx, uid, "free-kopi");
    const wrong = await confirm(ctx, "u-seller-noodles", r.body.code);
    expect(wrong.status).toBe(403);
    expect(wrong.body).toMatchObject({ error: "wrong_stall", message: "This reward is for Drinks." });
    expect((await confirm(ctx, "u-seller-drinks", r.body.code)).status).toBe(200);
  });

  it("used → 409, expired → 410, unknown → 404, junk → 400", async () => {
    const ctx = await fresh();
    const uid = await student(ctx, 400);
    const r = await redeem(ctx, uid, "free-kopi");
    await confirm(ctx, "u-seller-drinks", r.body.code);
    expect((await confirm(ctx, "u-seller-drinks", r.body.code)).body.error).toBe("used");
    const r2 = await redeem(ctx, uid, "free-kopi");
    ctx.raw.exec(`UPDATE redemptions SET expires_at = ${Date.now() - 1} WHERE id = '${r2.body.id}'`);
    const exp = await confirm(ctx, "u-seller-drinks", r2.body.code);
    expect([exp.status, exp.body.error]).toEqual([410, "expired"]);
    const none = await confirm(ctx, "u-seller-drinks", "ZZZZZZ");
    expect([none.status, none.body.error]).toEqual([404, "not_found"]);
    const junk = await confirm(ctx, "u-seller-drinks", "abc");
    expect([junk.status, junk.body.error]).toEqual([400, "invalid_code"]);
  });

  it("two confirms at once: one wins", async () => {
    const ctx = await fresh();
    const uid = await student(ctx, 160);
    const r = await redeem(ctx, uid, "free-kopi");
    const res = await Promise.all([confirm(ctx, "u-seller-drinks", r.body.code), confirm(ctx, "u-seller-drinks", r.body.code)]);
    expect(res.map((x) => x.status).sort()).toEqual([200, 409]);
  });

  it("spending doesn't change the leaderboard", async () => {
    const ctx = await fresh();
    const uid = await student(ctx, 160);
    const before = (await ctx.req("/api/leaderboard", { as: uid })).body.me.points;
    const r = await redeem(ctx, uid, "free-kopi");
    await confirm(ctx, "u-seller-drinks", r.body.code);
    expect((await ctx.req("/api/leaderboard", { as: uid })).body.me.points).toBe(before);
    expect((await ctx.req("/api/me/summary", { as: uid })).body.points_total).toBe(160);
  });

  it("only sellers can confirm", async () => {
    const ctx = await fresh();
    const uid = await student(ctx, 0);
    expect((await confirm(ctx, uid, "ABCDEF")).status).toBe(403);
  });
});
