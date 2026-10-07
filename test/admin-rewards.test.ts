import { describe, expect, it } from "vitest";
import { setup } from "./helpers/setup";

const admin = (ctx: any, path: string, body?: unknown) => ctx.req(path, { as: "u-admin", body });

describe("admin rewards", () => {
  it("is admin-only", async () => {
    const ctx = await setup();
    for (const as of ["u-alex", "u-seller-drinks"]) {
      expect((await ctx.req("/api/admin/rewards", { as })).status).toBe(403);
      expect((await ctx.req("/api/admin/rewards", { as, body: { name: "x", cost: 1 } })).status).toBe(403);
    }
  });

  it("creates a reward that students then see", async () => {
    const ctx = await setup();
    const res = await admin(ctx, "/api/admin/rewards", { name: "Free tea", cost: 120, stall_id: "drinks", weekly_stock: 10, active: true });
    expect(res.status).toBe(201);
    expect(res.body.reward).toMatchObject({ name: "Free tea", cost: 120, stall_id: "drinks", stall_name: "Drinks", weekly_stock: 10, active: true });
    expect(res.body.reward.id).toMatch(/^free-tea-[0-9a-f]{4}$/);
    const names = (await ctx.req("/api/rewards", { as: "u-alex" })).body.rewards.map((r: any) => r.name);
    expect(names).toContain("Free tea");
  });

  it.each([
    [{ name: "", cost: 10 }],
    [{ name: "x".repeat(61), cost: 10 }],
    [{ name: "x", cost: 0 }],
    [{ name: "x", cost: 1.5 }],
    [{ name: "x", cost: 10, stall_id: "nope" }],
    [{ name: "x", cost: 10, weekly_stock: -1 }],
    [{ name: "x", cost: 10, active: "yes" }],
    [{ cost: 10 }],
  ])("400 invalid_reward for %j", async (body) => {
    const ctx = await setup();
    const res = await admin(ctx, "/api/admin/rewards", body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_reward");
  });

  it("switching a reward off hides it from students", async () => {
    const ctx = await setup();
    const res = await admin(ctx, "/api/admin/rewards/egg-addon", { active: false });
    expect(res.body.reward.active).toBe(false);
    const ids = (await ctx.req("/api/rewards", { as: "u-alex" })).body.rewards.map((r: any) => r.id);
    expect(ids).not.toContain("egg-addon");
    expect((await admin(ctx, "/api/admin/rewards/nope", { active: false })).status).toBe(404);
  });

  it("a cost cut doesn't change a live code's hold; new codes use the new cost", async () => {
    const ctx = await setup();
    const uid = (await ctx.req("/api/session", { body: { display_name: "Holder" } })).body.user.id;
    ctx.raw.exec(`INSERT INTO activities (id,user_id,category,type,points,verified,source,created_at) VALUES ('h1','${uid}','waste','container_return',300,0,'manual',${Date.now() - 1000})`);
    const r = await ctx.req("/api/rewards/free-kopi/redeem", { as: uid, body: {} });
    await admin(ctx, "/api/admin/rewards/free-kopi", { cost: 100 });
    expect((await ctx.req("/api/rewards", { as: uid })).body).toMatchObject({ spent: 150, balance: 150 });
    await ctx.req(`/api/rewards/redemptions/${r.body.id}/cancel`, { as: uid, body: {} });
    expect((await ctx.req("/api/rewards/free-kopi/redeem", { as: uid, body: {} })).body.cost).toBe(100);
  });

  it("lists this week's redemptions and live holds per reward", async () => {
    const ctx = await setup();
    const uid = (await ctx.req("/api/session", { body: { display_name: "Counter" } })).body.user.id;
    ctx.raw.exec(`INSERT INTO activities (id,user_id,category,type,points,verified,source,created_at) VALUES ('h2','${uid}','waste','container_return',500,0,'manual',${Date.now() - 1000})`);
    const r = await ctx.req("/api/rewards/free-kopi/redeem", { as: uid, body: {} });
    let kopi = (await admin(ctx, "/api/admin/rewards")).body.rewards.find((x: any) => x.id === "free-kopi");
    expect(kopi).toMatchObject({ redeemed_this_week: 0, pending_now: 1 });
    await ctx.req("/api/stall/redeem", { as: "u-seller-drinks", body: { code: r.body.code } });
    kopi = (await admin(ctx, "/api/admin/rewards")).body.rewards.find((x: any) => x.id === "free-kopi");
    expect(kopi).toMatchObject({ redeemed_this_week: 1, pending_now: 0 });
  });

  it("exports redemptions as CSV, with lapsed holds shown as expired", async () => {
    const ctx = await setup();
    const uid = (await ctx.req("/api/session", { body: { display_name: "Csv" } })).body.user.id;
    ctx.raw.exec(`INSERT INTO activities (id,user_id,category,type,points,verified,source,created_at) VALUES ('h3','${uid}','waste','container_return',200,0,'manual',${Date.now() - 1000})`);
    const r = await ctx.req("/api/rewards/free-kopi/redeem", { as: uid, body: {} });
    ctx.raw.exec(`UPDATE redemptions SET expires_at = ${Date.now() - 1}`);
    const res = await ctx.req("/api/admin/redemptions.csv", { as: "u-admin" }); // body isn't JSON; read it again below
    expect(res.status).toBe(200);
    const { app } = await import("../src/worker/app");
    const { sign } = await import("../src/worker/lib/token");
    const text = await (await app.request("https://app.test/api/admin/redemptions.csv", { headers: { cookie: `uid=${encodeURIComponent(await sign("u-admin", ctx.env.COOKIE_SECRET))}` } }, ctx.env)).text();
    const [header, row] = text.trim().split("\r\n");
    expect(header).toBe("redemption_id,user_id,reward_id,reward_name,cost,status,code,created_at_sgt,expires_at_sgt,redeemed_at_sgt,stall_id,week_start_sgt");
    expect(row.startsWith(`${r.body.id},${uid},free-kopi,Free kopi,150,expired,${r.body.code},`)).toBe(true);
    expect(res.headers.get("content-type")).toContain("text/csv");
  });
});
