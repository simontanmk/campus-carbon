import { describe, expect, it } from "vitest";
import { app } from "../src/worker/app";
import { sign } from "../src/worker/lib/token";
import { setup } from "./helpers/setup";

async function csvAs(ctx: Awaited<ReturnType<typeof setup>>, uid: string) {
  return app.request("https://app.test/api/admin/export.csv", { headers: { cookie: `uid=${encodeURIComponent(await sign(uid, ctx.env.COOKIE_SECRET))}` } }, ctx.env);
}

describe("GET /api/admin/export.csv", () => {
  it("exports every activity with verified and source, as an attachment", async () => {
    const ctx = await setup();
    ctx.raw.exec(`INSERT INTO activities (id,user_id,category,type,points,verified,source,low_carbon,kg_co2e,detail_json,created_at)
      VALUES ('p1','u-alex','food','meal',5,0,'photo',1,0.39,'{"dish":"Noodles, with \\"tofu\\""}',${Date.UTC(2026, 8, 29, 4, 0)})`);
    const res = await csvAs(ctx, "u-admin");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="activities-\d{4}-\d{2}-\d{2}\.csv"/);
    const text = await res.text();
    const [header, ...lines] = text.trim().split("\r\n");
    expect(header).toBe("activity_id,user_id,category,type,verified,source,kg_co2e,points,low_carbon,stall_id,canteen,item_id,item_name,dish,mode,distance_km,created_at_sgt,week_start_sgt");
    const row = lines.find((l) => l.startsWith("p1,"))!;
    expect(row).toBe('p1,u-alex,food,meal,0,photo,0.39,5,1,,,,,"Noodles, with ""tofu""",,,2026-09-29T12:00:00+08:00,2026-09-28');
    expect(lines.length).toBe((ctx.raw.prepare("SELECT COUNT(*) AS n FROM activities").get() as any).n);
  });

  it("is admin-only", async () => {
    const ctx = await setup();
    expect((await csvAs(ctx, "u-alex")).status).toBe(403);
  });
});
