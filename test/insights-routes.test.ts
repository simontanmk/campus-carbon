import { describe, expect, it } from "vitest";
import { setup as baseSetup } from "./helpers/setup";

async function setup() {
  const ctx = await baseSetup();
  ctx.raw.exec("DELETE FROM activities WHERE id LIKE 'seed-%'"); // controlled data only
  return ctx;
}
type Ctx = Awaited<ReturnType<typeof setup>>;
let n = 0;
function meal(ctx: Ctx, user: string, stall: string, item: string, low: 0 | 1, kg: number, at = Date.now() - 60_000) {
  ctx.raw.exec(`INSERT INTO activities (id,user_id,category,type,points,verified,source,stall_id,item_id,low_carbon,kg_co2e,created_at)
    VALUES ('r${n++}','${user}','food','meal',20,1,'qr','${stall}','${item}',${low},${kg},${at})`);
}

describe("GET /api/impact", () => {
  it("works with no session and is cacheable for 30 s", async () => {
    const ctx = await setup();
    const res = await ctx.req("/api/impact");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=30");
  });

  it("is all zeros on an empty campus", async () => {
    const ctx = await setup();
    const b = (await ctx.req("/api/impact")).body;
    expect(b).toMatchObject({ kg_saved: 0, low_carbon_share: null, verified_meals: 0, active_students: 0, under_budget: null });
    expect(b.weeks).toHaveLength(8);
    expect(b.avg_meal_kg).toBeGreaterThan(0); // the seeded menu is priced
  });

  it("never exposes names, user ids or stall ids", async () => {
    const ctx = await setup();
    meal(ctx, "u-alex", "noodles", "veg-noodles", 1, 0.4);
    meal(ctx, "u-bea", "econ-rice", "econ-veg-egg", 1, 0.6);
    const b = (await ctx.req("/api/impact")).body;
    expect(b.verified_meals).toBe(2);
    expect(b.kg_saved).toBeGreaterThan(0);
    const text = JSON.stringify(b);
    for (const s of ["u-alex", "u-bea", "Alex", "Bea", "noodles", "econ-rice", "veg-noodles"]) expect(text).not.toContain(s);
  });
});

describe("GET /api/admin/insights", () => {
  it("is admin-only, including for a switched persona", async () => {
    const ctx = await setup();
    for (const as of ["u-alex", "u-seller-noodles"]) expect((await ctx.req("/api/admin/insights", { as })).status).toBe(403);
    expect((await ctx.req("/api/admin/insights")).status).toBe(401);
  });

  it("lists every stall with this week's figures and the top dishes", async () => {
    const ctx = await setup();
    meal(ctx, "u-alex", "noodles", "veg-noodles", 1, 0.4);
    meal(ctx, "u-bea", "noodles", "chicken-rice", 0, 1.36);
    const b = (await ctx.req("/api/admin/insights", { as: "u-admin" })).body;
    expect(b.stalls.map((s: any) => s.id).sort()).toEqual(["drinks", "econ-rice", "noodles"]);
    expect(b.stalls.find((s: any) => s.id === "noodles").this_week).toEqual({ meals: 2, low_carbon_share: 0.5, avg_kg: 0.88, byo: 0 });
    expect(b.top_dishes.map((d: any) => d.name).sort()).toEqual(["Chicken rice", "Vegetarian noodles with tofu"]);
    expect(b.weeks).toHaveLength(8);
  });
});

describe("GET /api/stall/insights", () => {
  it("shows a seller only their own stall, whatever the query says", async () => {
    const ctx = await setup();
    meal(ctx, "u-alex", "noodles", "veg-noodles", 1, 0.4);
    meal(ctx, "u-bea", "econ-rice", "econ-veg-egg", 1, 0.6);
    const own = (await ctx.req("/api/stall/insights?stall_id=econ-rice", { as: "u-seller-noodles" })).body;
    expect(own.this_week).toEqual({ meals: 1, low_carbon_share: 1, avg_kg: 0.4, byo: 0 });
    expect(own.last_week.meals).toBe(0);
  });

  it("is seller-only", async () => {
    const ctx = await setup();
    expect((await ctx.req("/api/stall/insights", { as: "u-alex" })).status).toBe(403);
  });
});

describe("impact edge cache", () => {
  it("serves repeat requests from the Cache API for 30 s instead of re-querying D1", async () => {
    const store = new Map<string, Response>();
    const fake = { match: async (k: Request) => store.get(k.url)?.clone(), put: async (k: Request, r: Response) => void store.set(k.url, r.clone()) };
    (globalThis as any).caches = { default: fake };
    try {
      const ctx = await setup();
      expect((await ctx.req("/api/impact")).body.verified_meals).toBe(0);
      meal(ctx, "u-alex", "noodles", "veg-noodles", 1, 0.4);
      expect((await ctx.req("/api/impact")).body.verified_meals).toBe(0); // cached copy
      store.clear();
      expect((await ctx.req("/api/impact")).body.verified_meals).toBe(1);
    } finally {
      delete (globalThis as any).caches;
    }
  });
});
