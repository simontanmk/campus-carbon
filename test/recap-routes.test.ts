import { describe, expect, it } from "vitest";
import { setup } from "./helpers/setup";

const fresh = async (ctx: Awaited<ReturnType<typeof setup>>, name = "Recap Student") =>
  (await ctx.req("/api/session", { body: { display_name: name } })).body.user.id as string;

describe("GET /api/me/recap", () => {
  it("is for students only", async () => {
    const ctx = await setup();
    for (const as of ["u-seller-noodles", "u-admin"]) expect((await ctx.req("/api/me/recap", { as })).status).toBe(403);
  });

  it("this week's points equal the leaderboard's", async () => {
    const ctx = await setup();
    const uid = await fresh(ctx);
    await ctx.req("/api/trips", { as: uid, body: { from_id: "hive", to_id: "north-spine", mode: "walk" } });
    const r = (await ctx.req("/api/me/recap?week=this", { as: uid })).body;
    const lb = (await ctx.req("/api/leaderboard", { as: uid })).body.me.points;
    expect(r.week).toBe("this");
    expect(r.empty).toBe(false);
    expect(r.walk_trips).toBe(1);
    expect(r.points).toBe(lb);
    expect(r.points).toBeGreaterThan(0);
    expect(r.first_name).toBe("Recap");
  });

  it("an unknown week means last week", async () => {
    const ctx = await setup();
    const uid = await fresh(ctx);
    const a = (await ctx.req("/api/me/recap?week=bogus", { as: uid })).body;
    const b = (await ctx.req("/api/me/recap", { as: uid })).body;
    expect(a.week).toBe("last");
    expect(b.week).toBe("last");
    expect(a.empty).toBe(true);
  });

  it("never contains another student's name or id", async () => {
    const ctx = await setup(); // seeded personas Alex, Bea, Chen have history
    const r = (await ctx.req("/api/me/recap", { as: "u-bea" })).body;
    expect(r.first_name).toBe("Bea");
    const text = JSON.stringify(r);
    for (const s of ["Alex", "Chen", "u-alex", "u-chen", "u-bea"]) expect(text).not.toContain(s);
  });
});

describe("/api/me/summary recap_ready", () => {
  it("is false for a brand-new student and true once they log something", async () => {
    const ctx = await setup();
    const uid = await fresh(ctx);
    expect((await ctx.req("/api/me/summary", { as: uid })).body.recap_ready).toBe(false);
    await ctx.req("/api/steps", { as: uid, body: { steps: 3000 } });
    expect((await ctx.req("/api/me/summary", { as: uid })).body.recap_ready).toBe(true);
  });
});

describe("recap and Today agree", () => {
  it("this week's recap points equal Today's points_week", async () => {
    const ctx = await setup();
    for (const uid of ["u-alex", "u-bea", "u-chen"]) {
      const today = (await ctx.req("/api/me/summary", { as: uid })).body.points_week;
      expect((await ctx.req("/api/me/recap?week=this", { as: uid })).body.points).toBe(today);
    }
  });
});

describe("recap_week on Today", () => {
  it("says which week the recap opens on: this week for a new student, last week when it has activity", async () => {
    const ctx = await setup();
    const uid = await fresh(ctx, "New Student");
    expect((await ctx.req("/api/me/summary", { as: uid })).body.recap_week).toBeNull();
    await ctx.req("/api/steps", { as: uid, body: { steps: 3000 } });
    expect((await ctx.req("/api/me/summary", { as: uid })).body.recap_week).toBe("this");
    ctx.raw.exec(`UPDATE activities SET created_at = created_at - 7 * 86400000 WHERE user_id = '${uid}'`);
    expect((await ctx.req("/api/me/summary", { as: uid })).body.recap_week).toBe("last");
  });
});
