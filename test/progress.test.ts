import { describe, expect, it } from "vitest";
import { sgWeekStart } from "../src/worker/lib/time";
import { setup as baseSetup } from "./helpers/setup";

// Persona history can fall inside the current week depending on the weekday the seed ran;
// remove it so rankings here depend only on what each test inserts.
async function setup() {
  const ctx = await baseSetup();
  ctx.raw.exec("DELETE FROM activities WHERE id LIKE 'seed-%'");
  return ctx;
}

async function student(ctx: Awaited<ReturnType<typeof setup>>, name = "Tester") {
  return (await ctx.req("/api/session", { body: { display_name: name } })).body.user.id as string;
}
function add(ctx: any, uid: string, id: string, type: string, extra: { low?: number; points?: number; detail?: object; at?: number } = {}) {
  ctx.raw.exec(
    `INSERT INTO activities (id,user_id,category,type,points,verified,source,low_carbon,detail_json,created_at) VALUES
     ('${id}','${uid}','food','${type}',${extra.points ?? 0},1,'qr',${extra.low ?? "NULL"},'${JSON.stringify(extra.detail ?? {})}',${extra.at ?? Date.now() - 1000})`,
  );
}

describe("GET /api/missions", () => {
  it("is all zero and locked for a new student", async () => {
    const ctx = await setup();
    const uid = await student(ctx);
    const b = (await ctx.req("/api/missions", { as: uid })).body;
    expect(b.streak).toBe(0);
    expect(b.daily).toHaveLength(2);
    expect(b.weekly).toHaveLength(4);
    expect([...b.daily, ...b.weekly].every((m: any) => m.progress === 0 && !m.completed)).toBe(true);
    expect(b.badges.every((x: any) => x.earned_at === null)).toBe(true);
  });

  it("reflects today's activity, streak and first badge", async () => {
    const ctx = await setup();
    const uid = await student(ctx);
    add(ctx, uid, "m1", "meal", { low: 1 });
    await ctx.req("/api/trips", { as: uid, body: { from_id: "hive", to_id: "north-spine", mode: "walk" } });
    const b = (await ctx.req("/api/missions", { as: uid })).body;
    expect(b.daily.every((m: any) => m.completed)).toBe(true);
    expect(b.streak).toBe(1);
    expect(b.badges.find((x: any) => x.id === "green-starter").earned_at).not.toBeNull();
  });

  it("awards Carbon Champion to last week's top student", async () => {
    const ctx = await setup();
    const uid = await student(ctx, "Zed");
    add(ctx, uid, "big", "meal", { points: 999, at: sgWeekStart(Date.now()) - 86_400_000 });
    const b = (await ctx.req("/api/missions", { as: uid })).body;
    expect(b.badges.find((x: any) => x.id === "carbon-champion").earned_at).toBe(sgWeekStart(Date.now()));
  });

  it("is student-only", async () => {
    const ctx = await setup();
    expect((await ctx.req("/api/missions", { as: "u-seller-econ" })).status).toBe(403);
  });
});

describe("GET /api/leaderboard", () => {
  it("ranks this week's students by activity plus mission points", async () => {
    const ctx = await setup();
    const a = await student(ctx, "Ann");
    const b = await student(ctx, "Ben");
    add(ctx, a, "a1", "meal", { low: 1, points: 20 }); // +20 activity, +20 daily mission
    add(ctx, b, "b1", "meal", { low: 0, points: 0 });
    const res = await ctx.req("/api/leaderboard", { as: a });
    expect(res.status).toBe(200);
    expect(res.body.top[0]).toEqual({ rank: 1, display_name: "Ann", points: 40, me: true });
    expect(res.body.top.find((r: any) => r.display_name === "Ben")).toBeUndefined();
    expect(res.body.me).toEqual({ rank: 1, points: 40 });
  });

  it("gives a zero-point student rank null and never lists sellers or admins", async () => {
    const ctx = await setup();
    const a = await student(ctx);
    add(ctx, "u-seller-econ", "s1", "meal", { points: 500 });
    const res = await ctx.req("/api/leaderboard", { as: a });
    expect(res.body.me).toEqual({ rank: null, points: 0 });
    expect(res.body.top.some((r: any) => r.display_name === "Economy Rice seller")).toBe(false);
  });

  it("returns at most 20 rows but still ranks me outside them", async () => {
    const ctx = await setup();
    for (let i = 0; i < 22; i++) {
      const id = `u-bulk-${i}`;
      ctx.raw.exec(`INSERT INTO users (id,display_name,role,created_at) VALUES ('${id}','Bulk ${String(i).padStart(2, "0")}','student',0)`);
      add(ctx, id, `bulk-${i}`, "meal", { points: 100 + i });
    }
    const me = await student(ctx, "Last");
    add(ctx, me, "mine", "meal", { points: 1 });
    const res = await ctx.req("/api/leaderboard", { as: me });
    expect(res.body.top).toHaveLength(20);
    expect(res.body.me).toEqual({ rank: 23, points: 1 });
  });
});
