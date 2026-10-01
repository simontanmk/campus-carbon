import { describe, expect, it } from "vitest";
import { setup } from "./helpers/setup";

describe("admin settings", () => {
  it("lists every setting and mission reward with defaults", async () => {
    const ctx = await setup();
    const res = await ctx.req("/api/admin/settings", { as: "u-admin" });
    expect(res.status).toBe(200);
    expect(res.body.settings.points_meal_low_carbon).toBe(20);
    expect(res.body.missions.find((m: any) => m.id === "weekly-low-meals")).toMatchObject({ points: 100, default_points: 100 });
  });

  it("saves values, and the new mission reward reaches missions, Today and Ranks consistently", async () => {
    const ctx = await setup();
    const saved = await ctx.req("/api/admin/settings", { as: "u-admin", body: { values: { "mission_points_daily-low-meal": 50, points_meal_low_carbon: 25 } } });
    expect(saved.status).toBe(200);
    expect(saved.body.settings.points_meal_low_carbon).toBe(25);
    expect(saved.body.missions.find((m: any) => m.id === "daily-low-meal").points).toBe(50);

    const uid = (await ctx.req("/api/session", { body: { display_name: "Config" } })).body.user.id;
    ctx.raw.exec(`INSERT INTO activities (id,user_id,category,type,points,verified,source,low_carbon,created_at) VALUES ('c','${uid}','food','meal',25,1,'qr',1,${Date.now() - 1000})`);
    const missions = (await ctx.req("/api/missions", { as: uid })).body;
    expect(missions.daily.find((m: any) => m.id === "daily-low-meal")).toMatchObject({ points: 50, completed: true });
    const today = (await ctx.req("/api/me/summary", { as: uid })).body.points_week;
    const ranks = (await ctx.req("/api/leaderboard", { as: uid })).body.me.points;
    expect(today).toBe(75);
    expect(ranks).toBe(today);
  });

  it.each([
    [{ values: { points_byo: -1 } }],
    [{ values: { points_byo: 1.5 } }],
    [{ values: { points_byo: "10" } }],
    [{ values: { not_a_setting: 5 } }],
    [{ values: { "mission_points_nope": 5 } }],
    [{ values: [] }],
    [{}],
  ])("400 invalid_setting for %j", async (body) => {
    const ctx = await setup();
    const res = await ctx.req("/api/admin/settings", { as: "u-admin", body });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_setting");
  });

  it("is admin-only", async () => {
    const ctx = await setup();
    expect((await ctx.req("/api/admin/settings", { as: "u-alex" })).status).toBe(403);
  });
});
