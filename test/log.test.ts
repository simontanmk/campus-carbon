import { describe, expect, it } from "vitest";
import { setup } from "./helpers/setup";

async function newStudent(ctx: Awaited<ReturnType<typeof setup>>) {
  const res = await ctx.req("/api/session", { body: { display_name: "Tester" } });
  return res.body.user.id as string;
}

describe("GET /api/locations", () => {
  it("lists campus locations by name, students only", async () => {
    const ctx = await setup();
    const res = await ctx.req("/api/locations", { as: "u-alex" });
    expect(res.body.locations[0]).toEqual({ id: "canteen-2", name: "Canteen 2" });
    expect(res.body.locations).toHaveLength(6);
    expect((await ctx.req("/api/locations", { as: "u-seller-econ" })).status).toBe(403);
  });
});

describe("GET /api/trips/options", () => {
  it("returns walk/shuttle/car for a pair in either direction", async () => {
    const ctx = await setup();
    const a = await ctx.req("/api/trips/options?from=hive&to=north-spine", { as: "u-alex" });
    const b = await ctx.req("/api/trips/options?from=north-spine&to=hive", { as: "u-alex" });
    expect(a.status).toBe(200);
    expect(a.body.options.map((o: any) => o.mode)).toEqual(["walk", "shuttle", "car"]);
    expect(b.body.distance_km).toBe(a.body.distance_km);
    expect(a.body.from).toEqual({ id: "hive", name: "The Hive" });
  });

  it.each([
    ["hive", "hive", 400, "same_place"],
    ["hive", "nowhere", 400, "unknown_place"],
    ["", "hive", 400, "unknown_place"],
  ])("from=%s to=%s → %i %s", async (from, to, status, error) => {
    const ctx = await setup();
    const res = await ctx.req(`/api/trips/options?from=${from}&to=${to}`, { as: "u-alex" });
    expect(res.status).toBe(status);
    expect(res.body.error).toBe(error);
  });

  it("404s when two known places have no route", async () => {
    const ctx = await setup();
    ctx.raw.exec("DELETE FROM routes WHERE (from_id='hive' AND to_id='north-spine') OR (from_id='north-spine' AND to_id='hive')");
    expect((await ctx.req("/api/trips/options?from=hive&to=north-spine", { as: "u-alex" })).body.error).toBe("no_route");
  });

  it("shows null kg for a pending factor", async () => {
    const ctx = await setup();
    ctx.raw.exec("UPDATE factors SET kg_per_unit=NULL WHERE key='shuttle'");
    const res = await ctx.req("/api/trips/options?from=hive&to=north-spine", { as: "u-alex" });
    expect(res.body.options.find((o: any) => o.mode === "shuttle").kg_co2e).toBeNull();
  });
});

describe("POST /api/trips", () => {
  it("logs a self-reported walk with 0 kg and +10", async () => {
    const ctx = await setup();
    const uid = await newStudent(ctx);
    const res = await ctx.req("/api/trips", { as: uid, body: { from_id: "hive", to_id: "north-spine", mode: "walk" } });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ points: 10, capped: false, kg_co2e: 0 });
    const row = ctx.raw.prepare("SELECT category, type, verified, source, kg_co2e, points, detail_json FROM activities WHERE user_id=?").get(uid) as any;
    expect(row).toMatchObject({ category: "mobility", type: "trip", verified: 0, source: "manual", kg_co2e: 0, points: 10 });
    expect(JSON.parse(row.detail_json)).toMatchObject({ from_id: "hive", to_id: "north-spine", mode: "walk" });
  });

  it("logs a car trip with kg and 0 points", async () => {
    const ctx = await setup();
    const uid = await newStudent(ctx);
    const res = await ctx.req("/api/trips", { as: uid, body: { from_id: "hall-11", to_id: "north-spine", mode: "car" } });
    expect(res.body.points).toBe(0);
    expect(res.body.kg_co2e).toBeGreaterThan(0);
  });

  it("stores NULL kg when the factor is pending", async () => {
    const ctx = await setup();
    const uid = await newStudent(ctx);
    ctx.raw.exec("UPDATE factors SET kg_per_unit=NULL WHERE key='car'");
    const res = await ctx.req("/api/trips", { as: uid, body: { from_id: "hive", to_id: "north-spine", mode: "car" } });
    expect(res.body.kg_co2e).toBeNull();
    expect((ctx.raw.prepare("SELECT kg_co2e FROM activities WHERE user_id=?").get(uid) as any).kg_co2e).toBeNull();
  });

  it("caps self-reported points at 30 per day but still logs the trip", async () => {
    const ctx = await setup();
    const uid = await newStudent(ctx);
    const walk = () => ctx.req("/api/trips", { as: uid, body: { from_id: "hive", to_id: "north-spine", mode: "walk" } });
    expect((await walk()).body.points).toBe(10);
    expect((await walk()).body.points).toBe(10);
    expect((await walk()).body.points).toBe(10);
    const fourth = await walk();
    expect(fourth.status).toBe(201);
    expect(fourth.body).toMatchObject({ points: 0, capped: true });
    expect((ctx.raw.prepare("SELECT COUNT(*) AS n FROM activities WHERE user_id=?").get(uid) as any).n).toBe(4);
  });

  it("verified stall points do not count toward the self-reported cap", async () => {
    const ctx = await setup();
    const uid = await newStudent(ctx);
    ctx.raw.exec(`INSERT INTO activities (id,user_id,category,type,points,verified,source,created_at) VALUES ('v','${uid}','food','meal',35,1,'qr',${Date.now()})`);
    expect((await ctx.req("/api/trips", { as: uid, body: { from_id: "hive", to_id: "north-spine", mode: "walk" } })).body.points).toBe(10);
  });

  it.each([
    [{ from_id: "hive", to_id: "hive", mode: "walk" }, "same_place"],
    [{ from_id: "hive", to_id: "mars", mode: "walk" }, "unknown_place"],
    [{ from_id: "hive", to_id: "north-spine", mode: "teleport" }, "invalid_mode"],
    [{ from_id: "hive", to_id: "north-spine" }, "invalid_mode"],
    [{}, "unknown_place"],
  ])("rejects %j with 400 %s", async (body, error) => {
    const ctx = await setup();
    const res = await ctx.req("/api/trips", { as: "u-alex", body });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(error);
  });
});

describe("POST /api/steps", () => {
  it("logs steps with 0 points and no kg", async () => {
    const ctx = await setup();
    const uid = await newStudent(ctx);
    const res = await ctx.req("/api/steps", { as: uid, body: { steps: 5200 } });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ points: 0, steps: 5200 });
    const row = ctx.raw.prepare("SELECT category, type, kg_co2e, verified, detail_json FROM activities WHERE user_id=?").get(uid) as any;
    expect(row).toMatchObject({ category: "mobility", type: "steps", kg_co2e: null, verified: 0 });
    expect(JSON.parse(row.detail_json)).toEqual({ steps: 5200 });
  });

  it.each([[0], [-5], [12.5], ["5000"], [100001], [null], [undefined]])("rejects steps=%j", async (steps) => {
    const ctx = await setup();
    const res = await ctx.req("/api/steps", { as: "u-alex", body: { steps } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_steps");
  });
});

describe("POST /api/returns", () => {
  it("awards +5 per container, capped, with NULL kg", async () => {
    const ctx = await setup();
    const uid = await newStudent(ctx);
    expect((await ctx.req("/api/returns", { as: uid, body: { count: 3 } })).body).toEqual({ points: 15, capped: false });
    expect((await ctx.req("/api/returns", { as: uid, body: { count: 4 } })).body).toEqual({ points: 15, capped: true });
    const rows = ctx.raw.prepare("SELECT category, type, kg_co2e, detail_json FROM activities WHERE user_id=? ORDER BY created_at").all(uid) as any[];
    expect(rows[0]).toMatchObject({ category: "waste", type: "container_return", kg_co2e: null });
    expect(JSON.parse(rows[1].detail_json)).toEqual({ count: 4 });
  });

  it.each([[0], [21], [1.5], ["2"], [null]])("rejects count=%j", async (count) => {
    const ctx = await setup();
    const res = await ctx.req("/api/returns", { as: "u-alex", body: { count } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_count");
  });
});
