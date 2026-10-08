import { describe, expect, it } from "vitest";
import { setup } from "./helpers/setup";
import { buildFactorsSql } from "../seed/sql";
import { COMBINED } from "../seed/factors";
import { computeKg } from "../src/worker/lib/carbon";

const combined = Object.fromEntries(Object.entries(COMBINED).map(([k, v]) => [k, v.kg]));
const all = (ctx: Awaited<ReturnType<typeof setup>>, sql: string, ...p: unknown[]) => ctx.raw.prepare(sql).all(...(p as any[])) as any[];

describe("buildFactorsSql", () => {
  it("the seeded menu already uses the combined table, and the SQL recompute agrees with computeKg", async () => {
    const ctx = await setup();
    ctx.raw.exec(buildFactorsSql());
    for (const i of all(ctx, "SELECT id, parts_json, kg_co2e FROM items")) {
      expect(i.kg_co2e, i.id).toBe(computeKg(JSON.parse(i.parts_json), combined));
    }
    expect(all(ctx, "SELECT kg_co2e FROM items WHERE id = 'chicken-rice'")[0].kg_co2e).toBe(0.93);
  });

  it("moves the untouched seed beef hor fun to beef-herd beef, leaving an admin-edited recipe alone", async () => {
    const ctx = await setup();
    ctx.raw.exec(`UPDATE items SET parts_json = '{"rice":80,"beef_dairy":80,"veg":30}' WHERE id = 'beef-hor-fun'`);
    ctx.raw.exec(`UPDATE items SET parts_json = '{"rice":60,"beef_dairy":80}' WHERE id = 'fish-soup'`);
    ctx.raw.exec(buildFactorsSql());
    expect(all(ctx, "SELECT parts_json FROM items WHERE id = 'beef-hor-fun'")[0].parts_json).toBe('{"rice":80,"beef_herd":80,"veg":30}');
    expect(all(ctx, "SELECT parts_json FROM items WHERE id = 'fish-soup'")[0].parts_json).toBe('{"rice":60,"beef_dairy":80}');
  });

  it("stores every dataset value with its citation", async () => {
    const ctx = await setup();
    const rows = all(ctx, "SELECT dataset, COUNT(*) AS n FROM factor_sources GROUP BY dataset ORDER BY dataset");
    expect(rows).toEqual([
      { dataset: "owid_luc_2018", n: 9 },
      { dataset: "owid_poore_2018", n: 13 },
      { dataset: "sg_ecosperity_2019", n: 13 },
    ]);
    expect(all(ctx, "SELECT kg_per_unit, source FROM factors WHERE key = 'poultry'")[0]).toMatchObject({ kg_per_unit: 7.05 });
    expect(all(ctx, "SELECT source FROM factors WHERE key = 'poultry'")[0].source).toContain("Ecosperity");
    expect(all(ctx, "SELECT source FROM factors WHERE key = 'tofu'")[0].source).not.toContain("Ecosperity");
  });

  it("recalculates old meals from their ingredients, leaving trips, points and low-carbon alone", async () => {
    const ctx = await setup();
    const now = Date.now();
    // An old OWID-era state: a stall meal, a photo meal, a trip and a cached nudge, all with old kg.
    ctx.raw.exec(`UPDATE items SET kg_co2e = 1.36 WHERE id = 'chicken-rice'`);
    ctx.raw.exec(`INSERT INTO activities (id,user_id,category,type,kg_co2e,points,verified,source,item_id,low_carbon,created_at) VALUES ('m1','u-alex','food','meal',1.36,0,1,'qr','chicken-rice',0,${now})`);
    ctx.raw.exec(`INSERT INTO activities (id,user_id,category,type,kg_co2e,points,verified,source,low_carbon,image_hash,detail_json,created_at) VALUES ('p1','u-alex','food','meal',0.39,5,0,'photo',1,'hp','{"dish":"Noodles","parts":{"wheat":100,"veg":100,"tofu":60},"ai":"live"}',${now})`);
    ctx.raw.exec(`INSERT INTO activities (id,user_id,category,type,kg_co2e,points,verified,source,detail_json,created_at) VALUES ('t1','u-alex','mobility','trip',0.12,0,0,'manual','{"mode":"car"}',${now})`);
    ctx.raw.exec(`INSERT INTO activities (id,user_id,category,type,kg_co2e,points,verified,source,low_carbon,image_hash,detail_json,created_at) VALUES ('p2','u-alex','food','meal',NULL,0,0,'photo',0,'hq','{"dish":"Unknown","parts":{},"ai":"mock"}',${now})`);
    ctx.raw.exec(`INSERT INTO summaries (user_id, week_start, text, created_at) VALUES ('u-alex', 0, 'You logged 1.36 kg', ${now})`);
    ctx.raw.exec(buildFactorsSql());
    const kg = (id: string) => all(ctx, "SELECT kg_co2e, points, low_carbon FROM activities WHERE id = ?", id)[0];
    expect(kg("m1")).toEqual({ kg_co2e: 0.93, points: 0, low_carbon: 0 });
    expect(kg("p1")).toEqual({ kg_co2e: computeKg({ wheat: 100, veg: 100, tofu: 60 }, combined), points: 5, low_carbon: 1 });
    expect(kg("p2").kg_co2e).toBeNull();
    expect(kg("t1").kg_co2e).toBe(0.12);
    expect(all(ctx, "SELECT COUNT(*) AS n FROM summaries")[0].n).toBe(0);
  });

  it("follows a changed factor and is safe to run twice", async () => {
    const ctx = await setup();
    ctx.raw.exec(buildFactorsSql());
    const before = all(ctx, "SELECT id, kg_co2e FROM activities WHERE category = 'food' ORDER BY id");
    ctx.raw.exec(buildFactorsSql());
    expect(all(ctx, "SELECT id, kg_co2e FROM activities WHERE category = 'food' ORDER BY id")).toEqual(before);
    // Seeded persona meals point at items, so they carry the item's kg.
    const mismatched = all(ctx, "SELECT a.id FROM activities a JOIN items i ON i.id = a.item_id WHERE a.category = 'food' AND a.kg_co2e IS NOT i.kg_co2e");
    expect(mismatched).toEqual([]);
  });
});
