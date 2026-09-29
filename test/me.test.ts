import { describe, expect, it } from "vitest";
import { sgWeekStart } from "../src/worker/lib/time";
import { setup as baseSetup } from "./helpers/setup";

// Seeded personas carry demo history; these tests need students with none.
async function setup() {
  const ctx = await baseSetup();
  ctx.raw.exec(`INSERT INTO users (id, display_name, role, created_at) VALUES ('u-dana','Dana','student',${Date.now()}), ('u-eve','Eve','student',${Date.now()})`);
  return ctx;
}

function insert(raw: any, id: string, points: number, created_at: number, extra = "") {
  raw.exec(
    `INSERT INTO activities (id,user_id,category,type,points,verified,source,item_id,low_carbon,kg_co2e,created_at)
     VALUES ('${id}','u-dana','food','meal',${points},1,'qr',${extra || "NULL"},1,0.65,${created_at})`,
  );
}

describe("GET /api/me/summary", () => {
  it("returns a ready budget for a seeded persona", async () => {
    const { req } = await setup();
    const b = (await req("/api/me/summary", { as: "u-alex" })).body.budget;
    expect(b.ready).toBe(true);
    expect(b.overall.target).toBeGreaterThan(0);
    expect(Object.keys(b.categories)).toEqual(["food", "mobility", "waste"]);
  });

  it("returns a not-ready budget for a brand-new student", async () => {
    const { req } = await setup();
    const s = await req("/api/session", { body: { display_name: "New" } });
    const b = (await req("/api/me/summary", { as: s.body.user.id })).body.budget;
    expect(b).toMatchObject({ ready: false, reason: "first_week" });
  });

  it("includes trip details with place names in recent", async () => {
    const { req } = await setup();
    const s = await req("/api/session", { body: { display_name: "Walker" } });
    await req("/api/trips", { as: s.body.user.id, body: { from_id: "hive", to_id: "north-spine", mode: "walk" } });
    const r = (await req("/api/me/summary", { as: s.body.user.id })).body.recent[0];
    expect(r.type).toBe("trip");
    expect(r.detail).toMatchObject({ mode: "walk" });
    expect(r.place_names).toEqual({ from: "The Hive", to: "North Spine" });
  });

  it("includes the week strip, best swap, the proposal's fact and the lightest low-carbon dish", async () => {
    const { req, raw } = await setup();
    const ws = sgWeekStart(Date.now());
    raw.exec(`INSERT INTO activities (id,user_id,category,type,points,verified,source,stall_id,item_id,low_carbon,kg_co2e,created_at) VALUES
      ('a','u-dana','food','meal',0,1,'qr','noodles','chicken-rice',0,1.36,${ws + 1000}),
      ('b','u-dana','food','meal',0,1,'qr','noodles','chicken-rice',0,1.36,${ws - 3 * 86_400_000}),
      ('c','u-dana','food','meal',20,1,'qr','econ-rice','econ-veg-egg',1,0.65,${ws + 86_400_000 + 1000})`);
    const b = (await req("/api/me/summary", { as: "u-dana" })).body;
    expect(b.days).toEqual(["other", "low", "none", "none", "none", "none", "none"]);
    expect(b.swap).toEqual({ from: "Chicken rice", to: "Vegetarian noodles with tofu", saves_kg: 0.97 });
    expect(b.fact).toEqual({ high: { name: "Fish soup with rice", kg: 2.03 }, low: { name: "Economy rice: 2 veg + egg", kg: 0.65 } });
    expect(b.featured).toEqual({ name: "Vegetarian noodles with tofu", stall_name: "Noodles & Rice Plates", kg_co2e: 0.39, points: 20 });
  });

  it("skips draft items for the featured dish and swap", async () => {
    const { req, raw } = await setup();
    raw.exec("UPDATE items SET status='draft' WHERE id='veg-noodles'");
    const b = (await req("/api/me/summary", { as: "u-eve" })).body;
    expect(b.featured.name).toBe("Economy rice: 2 veg + egg");
  });

  it("counts this week's meals, low-carbon meals and kg (drinks and last week excluded from meals)", async () => {
    const { req, raw } = await setup();
    const ws = sgWeekStart(Date.now());
    const row = (id: string, type: string, low: string, kg: string, at: number) =>
      raw.exec(`INSERT INTO activities (id,user_id,category,type,points,verified,source,low_carbon,kg_co2e,created_at) VALUES ('${id}','u-dana','food','${type}',0,1,'qr',${low},${kg},${at})`);
    row("m1", "meal", "1", "0.65", ws + 1000);
    row("m2", "meal", "0", "1.36", ws + 2000);
    row("d1", "drink", "NULL", "0.47", ws + 3000);
    row("d2", "drink", "NULL", "NULL", ws + 4000);
    row("old", "meal", "1", "0.65", ws - 1000);
    const b = (await req("/api/me/summary", { as: "u-dana" })).body;
    expect(b.meals_week).toBe(2);
    expect(b.low_carbon_meals_week).toBe(1);
    expect(b.kg_week).toBe(2.48);
  });

  it("sums total and this-week points and lists recent activity", async () => {
    const { req, raw } = await setup();
    const weekStart = sgWeekStart(Date.now());
    insert(raw, "old", 20, weekStart - 1000);
    insert(raw, "new", 35, weekStart + 1000, "'econ-veg-egg'");
    const res = await req("/api/me/summary", { as: "u-dana" });
    expect(res.status).toBe(200);
    expect(res.body.points_total).toBe(55);
    expect(res.body.points_week).toBe(35);
    expect(res.body.recent[0]).toMatchObject({ type: "meal", points: 35, item_name: "Economy rice: 2 veg + egg", low_carbon: true, verified: true });
    expect(res.body.recent).toHaveLength(2);
  });

  it("returns zeros for a new student", async () => {
    const { req } = await setup();
    expect((await req("/api/me/summary", { as: "u-eve" })).body).toMatchObject({ points_total: 0, points_week: 0, meals_week: 0, low_carbon_meals_week: 0, kg_week: 0, recent: [], swap: null, days: ["none", "none", "none", "none", "none", "none", "none"] });
  });

  it("is student-only", async () => {
    const { req } = await setup();
    expect((await req("/api/me/summary", { as: "u-seller-econ" })).status).toBe(403);
  });
});
