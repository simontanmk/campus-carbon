import { describe, expect, it } from "vitest";
import { setup } from "./helpers/setup";

describe("GET /api/stall", () => {
  it("returns the seller's stall and live items", async () => {
    const { req } = await setup();
    const res = await req("/api/stall", { as: "u-seller-econ" });
    expect(res.status).toBe(200);
    expect(res.body.stall.id).toBe("econ-rice");
    expect(res.body.items).toHaveLength(5);
    expect(res.body.items.find((i: any) => i.id === "econ-veg-egg")).toMatchObject({ low_carbon: true, kg_co2e: 0.65 });
  });

  it("hides draft items", async () => {
    const { req, raw } = await setup();
    raw.exec("UPDATE items SET status='draft' WHERE id='econ-pork'");
    const res = await req("/api/stall", { as: "u-seller-econ" });
    expect(res.body.items.map((i: any) => i.id)).not.toContain("econ-pork");
  });

  it("is seller-only", async () => {
    const { req } = await setup();
    expect((await req("/api/stall")).status).toBe(401);
    expect((await req("/api/stall", { as: "u-alex" })).status).toBe(403);
  });
});

describe("POST /api/stall/tokens", () => {
  it("creates a 90-second signed token and claim URL", async () => {
    const { req, raw } = await setup();
    const before = Date.now();
    const res = await req("/api/stall/tokens", { as: "u-seller-econ", body: { item_id: "econ-veg-egg", byo: true } });
    expect(res.status).toBe(201);
    expect(res.body.token.startsWith(`${res.body.id}.`)).toBe(true);
    expect(res.body.claim_url).toBe(`https://app.test/claim?t=${encodeURIComponent(res.body.token)}`);
    expect(res.body.expires_at - before).toBeGreaterThanOrEqual(90_000);
    expect(res.body.expires_at - before).toBeLessThan(95_000);
    const row = raw.prepare("SELECT stall_id, item_id, byo, method, used_at FROM tokens WHERE id=?").get(res.body.id);
    expect(row).toEqual({ stall_id: "econ-rice", item_id: "econ-veg-egg", byo: 1, method: "qr", used_at: null });
  });

  it("rejects another stall's item", async () => {
    const { req } = await setup();
    const res = await req("/api/stall/tokens", { as: "u-seller-econ", body: { item_id: "kopi" } });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("wrong_stall");
  });

  it("rejects unknown and draft items", async () => {
    const { req, raw } = await setup();
    raw.exec("UPDATE items SET status='draft' WHERE id='econ-pork'");
    for (const item_id of ["nope", "econ-pork", undefined]) {
      const res = await req("/api/stall/tokens", { as: "u-seller-econ", body: { item_id } });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("no_item");
    }
  });

  it("rejects when the stall is inactive", async () => {
    const { req, raw } = await setup();
    raw.exec("UPDATE stalls SET active=0 WHERE id='econ-rice'");
    const res = await req("/api/stall/tokens", { as: "u-seller-econ", body: { item_id: "econ-veg-egg" } });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("stall_inactive");
  });
});

describe("GET /api/stall/tokens/:id", () => {
  it("reports pending, then expired", async () => {
    const { req, raw } = await setup();
    const t = await req("/api/stall/tokens", { as: "u-seller-econ", body: { item_id: "econ-veg-egg" } });
    expect((await req(`/api/stall/tokens/${t.body.id}`, { as: "u-seller-econ" })).body).toMatchObject({ state: "pending", claimed_by: null });
    raw.exec(`UPDATE tokens SET expires_at = 0 WHERE id = '${t.body.id}'`);
    expect((await req(`/api/stall/tokens/${t.body.id}`, { as: "u-seller-econ" })).body.state).toBe("expired");
  });

  it("reports claimed with the student's name", async () => {
    const { req, raw } = await setup();
    const t = await req("/api/stall/tokens", { as: "u-seller-econ", body: { item_id: "econ-veg-egg" } });
    raw.exec(`UPDATE tokens SET used_at = 1, used_by = 'u-alex' WHERE id = '${t.body.id}'`);
    expect((await req(`/api/stall/tokens/${t.body.id}`, { as: "u-seller-econ" })).body).toMatchObject({ state: "claimed", claimed_by: "Alex" });
  });

  it("hides other stalls' tokens", async () => {
    const { req } = await setup();
    const t = await req("/api/stall/tokens", { as: "u-seller-econ", body: { item_id: "econ-veg-egg" } });
    expect((await req(`/api/stall/tokens/${t.body.id}`, { as: "u-seller-drinks" })).status).toBe(404);
  });
});
