import { describe, expect, it } from "vitest";
import { setup } from "./helpers/setup";

const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
const photo = { mime: "image/png", base64: PNG_1PX };

describe("admin menu import", () => {
  it("is admin-only (a switched persona is not an admin)", async () => {
    const ctx = await setup();
    for (const as of ["u-alex", "u-seller-econ"]) expect((await ctx.req("/api/admin/stalls", { as })).status).toBe(403);
    expect((await ctx.req("/api/admin/stalls", { as: "u-admin" })).body.stalls).toHaveLength(3);
  });

  it("turns a menu photo into draft items with kg from factors", async () => {
    const ctx = await setup();
    const res = await ctx.req("/api/admin/menu/photo", { as: "u-admin", body: { stall_id: "econ-rice", image: photo } });
    expect(res.status).toBe(201);
    expect(res.body.source).toBe("mock");
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0]).toMatchObject({ name: "Vegetable fried rice with egg", kind: "meal", status: "draft", low_carbon: true, kg_co2e: 0.63 });
    expect(res.body.items[1]).toMatchObject({ name: "Chicken cutlet rice", low_carbon: false });
    const live = (await ctx.req("/api/stall", { as: "u-seller-econ" })).body.items.map((i: any) => i.name);
    expect(live).not.toContain("Vegetable fried rice with egg");
  });

  it("approving a draft puts it on the seller's menu; editing parts recomputes kg", async () => {
    const ctx = await setup();
    const drafts = (await ctx.req("/api/admin/menu/photo", { as: "u-admin", body: { stall_id: "econ-rice", image: photo } })).body.items;
    const id = drafts[1].id;
    const edited = await ctx.req(`/api/admin/items/${id}`, { as: "u-admin", body: { name: "Tofu cutlet rice", parts: { rice: 80, tofu: 100, veg: 30 } } });
    expect(edited.body.item).toMatchObject({ name: "Tofu cutlet rice", low_carbon: true, kg_co2e: 0.68, status: "draft" });
    await ctx.req(`/api/admin/items/${id}`, { as: "u-admin", body: { status: "live" } });
    const live = (await ctx.req("/api/stall", { as: "u-seller-econ" })).body.items.map((i: any) => i.name);
    expect(live).toContain("Tofu cutlet rice");
  });

  it("deletes drafts but refuses to delete live items", async () => {
    const ctx = await setup();
    const drafts = (await ctx.req("/api/admin/menu/photo", { as: "u-admin", body: { stall_id: "econ-rice", image: photo } })).body.items;
    expect((await ctx.req(`/api/admin/items/${drafts[0].id}/delete`, { as: "u-admin", body: {} })).body).toEqual({ deleted: true });
    const res = await ctx.req("/api/admin/items/econ-veg-egg/delete", { as: "u-admin", body: {} });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("not_draft");
  });

  it.each([
    [{ stall_id: "nope", image: photo }, 404, "no_stall"],
    [{ stall_id: "econ-rice", image: { mime: "text/plain", base64: "QQ==" } }, 400, "invalid_image"],
  ])("rejects %j", async (body, status, error) => {
    const ctx = await setup();
    const res = await ctx.req("/api/admin/menu/photo", { as: "u-admin", body });
    expect(res.status).toBe(status);
    expect(res.body.error).toBe(error);
  });

  it.each([
    [{ name: "" }],
    [{ kind: "snack" }],
    [{ status: "archived" }],
    [{ parts: [1] }],
  ])("400 invalid_item for %j", async (body) => {
    const ctx = await setup();
    const res = await ctx.req("/api/admin/items/econ-veg-egg", { as: "u-admin", body });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_item");
  });

  it("404s for an unknown item", async () => {
    const ctx = await setup();
    expect((await ctx.req("/api/admin/items/nope", { as: "u-admin", body: { name: "X" } })).status).toBe(404);
  });
});
