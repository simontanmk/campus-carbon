import { describe, expect, it } from "vitest";
import { setup } from "./helpers/setup";

async function makeToken(ctx: Awaited<ReturnType<typeof setup>>, seller: string, item_id: string, byo = false) {
  const res = await ctx.req("/api/stall/tokens", { as: seller, body: { item_id, byo } });
  expect(res.status).toBe(201);
  return res.body as { id: string; token: string };
}

describe("POST /api/claim — success", () => {
  it("awards low-carbon meal + BYO and marks the token used", async () => {
    const ctx = await setup();
    const t = await makeToken(ctx, "u-seller-econ", "econ-veg-egg", true);
    const res = await ctx.req("/api/claim", { as: "u-alex", body: { t: t.token } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ item_name: "Economy rice: 2 veg + egg", low_carbon: true, kg_co2e: 0.65, points: 35 });
    expect(res.body.activities).toEqual([
      { type: "meal", points: 20, kg_co2e: 0.65 },
      { type: "byo", points: 15, kg_co2e: null },
    ]);
    const acts = ctx.raw.prepare("SELECT category, type, verified, source, token_id, low_carbon FROM activities WHERE user_id='u-alex' ORDER BY type DESC").all();
    expect(acts).toEqual([
      { category: "food", type: "meal", verified: 1, source: "qr", token_id: t.id, low_carbon: 1 },
      { category: "waste", type: "byo", verified: 1, source: "qr", token_id: t.id, low_carbon: null },
    ]);
    expect((ctx.raw.prepare("SELECT used_by FROM tokens WHERE id=?").get(t.id) as any).used_by).toBe("u-alex");
  });

  it("records a non-low-carbon meal with 0 points", async () => {
    const ctx = await setup();
    const t = await makeToken(ctx, "u-seller-noodles", "chicken-rice");
    const res = await ctx.req("/api/claim", { as: "u-alex", body: { t: t.token } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ low_carbon: false, kg_co2e: 1.36, points: 0 });
  });

  it("records a drink with unknown kg as NULL, not 0", async () => {
    const ctx = await setup();
    const t = await makeToken(ctx, "u-seller-drinks", "teh-o-kosong");
    const res = await ctx.req("/api/claim", { as: "u-alex", body: { t: t.token } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ kind: "drink", kg_co2e: null, points: 0 });
    const row = ctx.raw.prepare("SELECT kg_co2e, low_carbon, type FROM activities WHERE user_id='u-alex'").get();
    expect(row).toEqual({ kg_co2e: null, low_carbon: null, type: "drink" });
  });
});

describe("POST /api/claim — rejections", () => {
  it("needs a session and does not burn the token", async () => {
    const ctx = await setup();
    const t = await makeToken(ctx, "u-seller-econ", "econ-veg-egg");
    const res = await ctx.req("/api/claim", { body: { t: t.token } });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("no_session");
    expect((ctx.raw.prepare("SELECT used_at FROM tokens WHERE id=?").get(t.id) as any).used_at).toBeNull();
  });

  it("blocks sellers and admins", async () => {
    const ctx = await setup();
    const t = await makeToken(ctx, "u-seller-econ", "econ-veg-egg");
    for (const as of ["u-seller-econ", "u-admin"]) {
      const res = await ctx.req("/api/claim", { as, body: { t: t.token } });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("not_student");
    }
  });

  it.each([[""], ["garbage"], ["abc.def"], [null], [42], [undefined]])("invalid token %j → 400", async (bad) => {
    const ctx = await setup();
    const res = await ctx.req("/api/claim", { as: "u-alex", body: { t: bad } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_token");
  });

  it("tampered signature → 400", async () => {
    const ctx = await setup();
    const t = await makeToken(ctx, "u-seller-econ", "econ-veg-egg");
    const res = await ctx.req("/api/claim", { as: "u-alex", body: { t: t.token.slice(0, -3) + "AAA" } });
    expect(res.status).toBe(400);
  });

  it("body that is not JSON → 400", async () => {
    const ctx = await setup();
    const res = await ctx.req("/api/claim", { as: "u-alex", method: "POST" });
    expect(res.status).toBe(400);
  });

  it("second claim of the same token → 409", async () => {
    const ctx = await setup();
    const t = await makeToken(ctx, "u-seller-econ", "econ-veg-egg");
    expect((await ctx.req("/api/claim", { as: "u-alex", body: { t: t.token } })).status).toBe(200);
    const again = await ctx.req("/api/claim", { as: "u-bea", body: { t: t.token } });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("used");
  });

  it("two simultaneous claims: exactly one wins", async () => {
    const ctx = await setup();
    const t = await makeToken(ctx, "u-seller-econ", "econ-veg-egg");
    const results = await Promise.all([
      ctx.req("/api/claim", { as: "u-alex", body: { t: t.token } }),
      ctx.req("/api/claim", { as: "u-bea", body: { t: t.token } }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((ctx.raw.prepare("SELECT COUNT(*) AS n FROM activities").get() as any).n).toBe(1);
  });

  it("expired → 410", async () => {
    const ctx = await setup();
    const t = await makeToken(ctx, "u-seller-econ", "econ-veg-egg");
    ctx.raw.exec(`UPDATE tokens SET expires_at = ${Date.now() - 1} WHERE id = '${t.id}'`);
    const res = await ctx.req("/api/claim", { as: "u-alex", body: { t: t.token } });
    expect(res.status).toBe(410);
    expect(res.body.error).toBe("expired");
  });

  it("inactive stall → 403", async () => {
    const ctx = await setup();
    const t = await makeToken(ctx, "u-seller-econ", "econ-veg-egg");
    ctx.raw.exec("UPDATE stalls SET active = 0 WHERE id = 'econ-rice'");
    const res = await ctx.req("/api/claim", { as: "u-alex", body: { t: t.token } });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("stall_inactive");
  });

  it("same stall within 10 minutes → 429 rate_limited", async () => {
    const ctx = await setup();
    const t1 = await makeToken(ctx, "u-seller-econ", "econ-veg-egg");
    const t2 = await makeToken(ctx, "u-seller-econ", "econ-veg-tofu");
    expect((await ctx.req("/api/claim", { as: "u-alex", body: { t: t1.token } })).status).toBe(200);
    const res = await ctx.req("/api/claim", { as: "u-alex", body: { t: t2.token } });
    expect(res.status).toBe(429);
    expect(res.body.error).toBe("rate_limited");
    expect((ctx.raw.prepare("SELECT used_at FROM tokens WHERE id=?").get(t2.id) as any).used_at).toBeNull();
  });

  it("same stall after 10 minutes is allowed", async () => {
    const ctx = await setup();
    ctx.raw.exec(
      `INSERT INTO activities (id,user_id,category,type,points,verified,source,stall_id,created_at) VALUES ('old','u-alex','food','meal',20,1,'qr','econ-rice',${Date.now() - 11 * 60_000})`,
    );
    const t = await makeToken(ctx, "u-seller-econ", "econ-veg-egg");
    expect((await ctx.req("/api/claim", { as: "u-alex", body: { t: t.token } })).status).toBe(200);
  });

  it("sixth verified claim today → 429 daily_limit", async () => {
    const ctx = await setup();
    const ago = Date.now() - 20 * 60_000; // outside the per-stall window, still today in SGT unless run just after midnight
    for (let i = 0; i < 5; i++) {
      ctx.raw.exec(
        `INSERT INTO activities (id,user_id,category,type,points,verified,source,stall_id,created_at) VALUES ('d${i}','u-alex','food','meal',0,1,'qr','noodles',${ago})`,
      );
    }
    const t = await makeToken(ctx, "u-seller-econ", "econ-veg-egg");
    const res = await ctx.req("/api/claim", { as: "u-alex", body: { t: t.token } });
    expect(res.status).toBe(429);
    expect(res.body.error).toBe("daily_limit");
  });
});
