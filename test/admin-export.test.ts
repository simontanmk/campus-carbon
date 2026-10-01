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
      VALUES ('p1','u-alex','food','meal',5,0,'photo',1,0.39,'{"dish":"Noodles, with \\"tofu\\"","ai":"live"}',${Date.UTC(2026, 8, 29, 4, 0)})`);
    const res = await csvAs(ctx, "u-admin");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="activities-\d{4}-\d{2}-\d{2}\.csv"/);
    const text = await res.text();
    const [header, ...lines] = text.trim().split("\r\n");
    expect(header).toBe("activity_id,user_id,category,type,verified,source,kg_co2e,points,low_carbon,stall_id,canteen,item_id,item_name,dish,ai,mode,from_id,to_id,distance_km,steps,count,image_hash,token_id,token_created_at_sgt,confirmed_at_sgt,confirm_latency_ms,created_at_sgt,week_start_sgt");
    const row = lines.find((l) => l.startsWith("p1,"))!;
    expect(row).toBe('p1,u-alex,food,meal,0,photo,0.39,5,1,,,,,"Noodles, with ""tofu""",live,,,,,,,,,,,,2026-09-29T12:00:00+08:00,2026-09-28');
    expect(lines.length).toBe((ctx.raw.prepare("SELECT COUNT(*) AS n FROM activities").get() as any).n);
  });

  it("includes steps, returns, trip places and NFC confirm latency", async () => {
    const ctx = await setup();
    const uid = (await ctx.req("/api/session", { body: { display_name: "Exporter" } })).body.user.id;
    await ctx.req("/api/steps", { as: uid, body: { steps: 5200 } });
    await ctx.req("/api/returns", { as: uid, body: { count: 3 } });
    await ctx.req("/api/trips", { as: uid, body: { from_id: "hive", to_id: "north-spine", mode: "walk" } });
    const t = (await ctx.req("/api/stall/tokens", { as: "u-seller-noodles", body: { item_id: "veg-noodles", method: "nfc" } })).body;
    await ctx.req("/api/tap", { as: uid, body: { stall_id: "noodles" } });
    await ctx.req(`/api/stall/tokens/${t.id}/confirm`, { as: "u-seller-noodles", body: {} });
    const text = await (await csvAs(ctx, "u-admin")).text();
    const [header, ...lines] = text.trim().split("\r\n");
    const cols = header.split(",");
    const rows = lines.map((l) => l.split(",")).filter((r) => r[1] === uid);
    const get = (r: string[], k: string) => r[cols.indexOf(k)];
    const byType = (ty: string) => rows.find((r) => get(r, "type") === ty)!;
    expect(get(byType("steps"), "steps")).toBe("5200");
    expect(get(byType("container_return"), "count")).toBe("3");
    expect([get(byType("trip"), "from_id"), get(byType("trip"), "to_id"), get(byType("trip"), "mode")]).toEqual(["hive", "north-spine", "walk"]);
    const meal = byType("meal");
    expect(get(meal, "token_id")).toBe(t.id);
    expect(get(meal, "source")).toBe("nfc");
    expect(Number(get(meal, "confirm_latency_ms"))).toBeGreaterThanOrEqual(0);
    expect(get(meal, "confirmed_at_sgt")).toMatch(/\+08:00$/);
  });

  it("is admin-only", async () => {
    const ctx = await setup();
    expect((await csvAs(ctx, "u-alex")).status).toBe(403);
  });
});
