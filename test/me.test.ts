import { describe, expect, it } from "vitest";
import { sgWeekStart } from "../src/worker/lib/time";
import { setup } from "./helpers/setup";

function insert(raw: any, id: string, points: number, created_at: number, extra = "") {
  raw.exec(
    `INSERT INTO activities (id,user_id,category,type,points,verified,source,item_id,low_carbon,kg_co2e,created_at)
     VALUES ('${id}','u-alex','food','meal',${points},1,'qr',${extra || "NULL"},1,0.65,${created_at})`,
  );
}

describe("GET /api/me/summary", () => {
  it("counts this week's meals, low-carbon meals and kg (drinks and last week excluded from meals)", async () => {
    const { req, raw } = await setup();
    const ws = sgWeekStart(Date.now());
    const row = (id: string, type: string, low: string, kg: string, at: number) =>
      raw.exec(`INSERT INTO activities (id,user_id,category,type,points,verified,source,low_carbon,kg_co2e,created_at) VALUES ('${id}','u-alex','food','${type}',0,1,'qr',${low},${kg},${at})`);
    row("m1", "meal", "1", "0.65", ws + 1000);
    row("m2", "meal", "0", "1.36", ws + 2000);
    row("d1", "drink", "NULL", "0.47", ws + 3000);
    row("d2", "drink", "NULL", "NULL", ws + 4000);
    row("old", "meal", "1", "0.65", ws - 1000);
    const b = (await req("/api/me/summary", { as: "u-alex" })).body;
    expect(b.meals_week).toBe(2);
    expect(b.low_carbon_meals_week).toBe(1);
    expect(b.kg_week).toBe(2.48);
  });

  it("sums total and this-week points and lists recent activity", async () => {
    const { req, raw } = await setup();
    const weekStart = sgWeekStart(Date.now());
    insert(raw, "old", 20, weekStart - 1000);
    insert(raw, "new", 35, weekStart + 1000, "'econ-veg-egg'");
    const res = await req("/api/me/summary", { as: "u-alex" });
    expect(res.status).toBe(200);
    expect(res.body.points_total).toBe(55);
    expect(res.body.points_week).toBe(35);
    expect(res.body.recent[0]).toMatchObject({ type: "meal", points: 35, item_name: "Economy rice: 2 veg + egg", low_carbon: true, verified: true });
    expect(res.body.recent).toHaveLength(2);
  });

  it("returns zeros for a new student", async () => {
    const { req } = await setup();
    expect((await req("/api/me/summary", { as: "u-bea" })).body).toEqual({ points_total: 0, points_week: 0, meals_week: 0, low_carbon_meals_week: 0, kg_week: 0, recent: [] });
  });

  it("is student-only", async () => {
    const { req } = await setup();
    expect((await req("/api/me/summary", { as: "u-seller-econ" })).status).toBe(403);
  });
});
