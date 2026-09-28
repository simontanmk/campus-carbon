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
    expect((await req("/api/me/summary", { as: "u-bea" })).body).toEqual({ points_total: 0, points_week: 0, recent: [] });
  });

  it("is student-only", async () => {
    const { req } = await setup();
    expect((await req("/api/me/summary", { as: "u-seller-econ" })).status).toBe(403);
  });
});
