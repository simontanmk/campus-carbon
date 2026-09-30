import { describe, expect, it, vi } from "vitest";
import { setup } from "./helpers/setup";

const live = (content: string) => ({
  AI_MODE: "live", AI_BASE_URL: "https://ai.test/v1", AI_MODEL: "m", AI_API_KEY: "k",
  AI_FETCH: vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })),
});

describe("POST /api/trips/parse", () => {
  it("maps typed text to place ids with the mock (no AI configured)", async () => {
    const ctx = await setup();
    const res = await ctx.req("/api/trips/parse", { as: "u-alex", body: { text: "hive to hall 11" } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ from_id: "hive", to_id: "hall-11", source: "mock" });
  });

  it("uses the live model when configured", async () => {
    const env = live('{"from_id":"north-spine","to_id":"src"}');
    const ctx = await setup(env);
    const res = await ctx.req("/api/trips/parse", { as: "u-alex", body: { text: "lecture then gym" } });
    expect(res.body).toEqual({ from_id: "north-spine", to_id: "src", source: "live" });
    const sent = JSON.parse((env.AI_FETCH.mock.calls[0] as any)[1].body);
    expect(sent.messages[0].content).toContain("hall-11 = Hall 11");
  });

  it.each([
    ["one place", '{"from_id":"hive","to_id":null}'],
    ["unknown place", '{"from_id":"hive","to_id":"mars"}'],
    ["same place", '{"from_id":"hive","to_id":"hive"}'],
  ])("422 no_match for %s", async (_n, content) => {
    const ctx = await setup(live(content));
    const res = await ctx.req("/api/trips/parse", { as: "u-alex", body: { text: "somewhere" } });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("no_match");
  });

  it("falls back to the mock when the model returns garbage", async () => {
    const ctx = await setup(live("not json"));
    const res = await ctx.req("/api/trips/parse", { as: "u-alex", body: { text: "hive to north spine" } });
    expect(res.body).toEqual({ from_id: "hive", to_id: "north-spine", source: "mock" });
  });

  it.each([[""], ["x".repeat(201)], [42], [null]])("400 for text=%j", async (text) => {
    const ctx = await setup();
    const res = await ctx.req("/api/trips/parse", { as: "u-alex", body: { text } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_text");
  });

  it("is student-only", async () => {
    const ctx = await setup();
    expect((await ctx.req("/api/trips/parse", { as: "u-seller-econ", body: { text: "hive to hall 11" } })).status).toBe(403);
  });
});
const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

async function freshStudent(ctx: Awaited<ReturnType<typeof setup>>) {
  return (await ctx.req("/api/session", { body: { display_name: "Snap" } })).body.user.id as string;
}

describe("POST /api/meals/photo", () => {
  it("returns a mock estimate with kg from factors and a hash", async () => {
    const ctx = await setup();
    const uid = await freshStudent(ctx);
    const res = await ctx.req("/api/meals/photo", { as: uid, body: { image: { mime: "image/png", base64: PNG_1PX } } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ dish: "Vegetarian noodles with tofu", kg_co2e: 0.39, low_carbon: true, points: 5, source: "mock" });
    expect(res.body.image_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ignores any carbon numbers the model invents and drops unknown ingredients", async () => {
    const ctx = await setup(live('{"dish":"Chicken rice","parts":{"rice":80,"poultry":100,"chilli":20},"kg_co2e":0.01,"confidence":0.9}'));
    const uid = await freshStudent(ctx);
    const res = await ctx.req("/api/meals/photo", { as: uid, body: { image: { mime: "image/png", base64: PNG_1PX } } });
    expect(res.body).toMatchObject({ dish: "Chicken rice", parts: { rice: 80, poultry: 100 }, kg_co2e: 1.34, low_carbon: false, points: 0, source: "live" });
  });

  it("an estimate with no usable parts is not low-carbon and earns 0", async () => {
    const ctx = await setup(live('{"dish":"Mystery plate","parts":{"chilli":20},"confidence":0.2}'));
    const uid = await freshStudent(ctx);
    const res = await ctx.req("/api/meals/photo", { as: uid, body: { image: { mime: "image/png", base64: PNG_1PX } } });
    expect(res.body).toMatchObject({ kg_co2e: null, low_carbon: false, points: 0 });
  });

  it.each([
    [{ mime: "image/gif", base64: PNG_1PX }],
    [{ mime: "image/png", base64: "not base64!!" }],
    [{ mime: "image/png", base64: "" }],
    [{ mime: "image/png", base64: "A".repeat(2_000_004) }],
    ["just a string"],
    [null],
  ])("400 invalid_image for %j", async (image) => {
    const ctx = await setup();
    const res = await ctx.req("/api/meals/photo", { as: "u-alex", body: { image } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_image");
  });
});

describe("POST /api/meals/photo/confirm", () => {
  it("logs an unverified photo meal, +5 when low-carbon, recomputing kg server-side", async () => {
    const ctx = await setup();
    const uid = await freshStudent(ctx);
    const a = (await ctx.req("/api/meals/photo", { as: uid, body: { image: { mime: "image/png", base64: PNG_1PX } } })).body;
    const res = await ctx.req("/api/meals/photo/confirm", { as: uid, body: { dish: a.dish, parts: a.parts, image_hash: a.image_hash, kg_co2e: 0 } });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ points: 5, capped: false, kg_co2e: 0.39, low_carbon: true });
    const row = ctx.raw.prepare("SELECT category, type, verified, source, low_carbon, kg_co2e, image_hash, detail_json FROM activities WHERE user_id=?").get(uid) as any;
    expect(row).toMatchObject({ category: "food", type: "meal", verified: 0, source: "photo", low_carbon: 1, kg_co2e: 0.39, image_hash: a.image_hash });
    expect(JSON.parse(row.detail_json)).toMatchObject({ dish: "Vegetarian noodles with tofu" });
  });

  it("rejects the same photo twice, at analyse and at confirm", async () => {
    const ctx = await setup();
    const uid = await freshStudent(ctx);
    const a = (await ctx.req("/api/meals/photo", { as: uid, body: { image: { mime: "image/png", base64: PNG_1PX } } })).body;
    await ctx.req("/api/meals/photo/confirm", { as: uid, body: { dish: a.dish, parts: a.parts, image_hash: a.image_hash } });
    const again = await ctx.req("/api/meals/photo", { as: uid, body: { image: { mime: "image/png", base64: PNG_1PX } } });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("duplicate_photo");
    const confirmAgain = await ctx.req("/api/meals/photo/confirm", { as: uid, body: { dish: a.dish, parts: a.parts, image_hash: a.image_hash } });
    expect(confirmAgain.status).toBe(409);
  });

  it("respects the daily self-reported cap", async () => {
    const ctx = await setup();
    const uid = await freshStudent(ctx);
    ctx.raw.exec(`INSERT INTO activities (id,user_id,category,type,points,verified,source,created_at) VALUES ('w','${uid}','mobility','trip',28,0,'manual',${Date.now() - 1000})`);
    const res = await ctx.req("/api/meals/photo/confirm", { as: uid, body: { dish: "Veg noodles", parts: { wheat: 100, veg: 100, tofu: 60 }, image_hash: "a".repeat(64) } });
    expect(res.body).toMatchObject({ points: 2, capped: true });
  });

  it.each([
    [{ dish: "", parts: {}, image_hash: "a".repeat(64) }],
    [{ dish: "Rice", parts: {}, image_hash: "short" }],
    [{ dish: "Rice", parts: "x", image_hash: "a".repeat(64) }],
  ])("400 invalid_meal for %j", async (body) => {
    const ctx = await setup();
    const res = await ctx.req("/api/meals/photo/confirm", { as: "u-alex", body });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_meal");
  });
});
describe("GET /api/me/nudge", () => {
  it("writes a template nudge from the student's own numbers (mock)", async () => {
    const ctx = await setup();
    const uid = await freshStudent(ctx);
    ctx.raw.exec(`INSERT INTO activities (id,user_id,category,type,points,verified,source,stall_id,item_id,low_carbon,kg_co2e,created_at)
      VALUES ('n1','${uid}','food','meal',0,1,'qr','noodles','chicken-rice',0,1.36,${Date.now() - 1000})`);
    const res = await ctx.req("/api/me/nudge", { as: uid });
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("mock");
    expect(res.body.text).toContain("1.36 kg");
    expect(res.body.text).toContain("0.97 kg");
  });

  it("sends only computed facts to the model and caches a live nudge for the week", async () => {
    const env = live('{"text":"A calm, specific sentence."}');
    const ctx = await setup(env);
    const uid = await freshStudent(ctx);
    expect((await ctx.req("/api/me/nudge", { as: uid })).body).toEqual({ text: "A calm, specific sentence.", source: "live" });
    const sent = JSON.parse((env.AI_FETCH.mock.calls[0] as any)[1].body).messages[1].content;
    expect(JSON.parse(sent)).toMatchObject({ first_name: "Snap", week_kg: 0 });
    await ctx.req("/api/me/nudge", { as: uid });
    expect(env.AI_FETCH).toHaveBeenCalledTimes(1);
  });

  it("does not cache a mock nudge", async () => {
    const ctx = await setup();
    const uid = await freshStudent(ctx);
    await ctx.req("/api/me/nudge", { as: uid });
    expect((ctx.raw.prepare("SELECT COUNT(*) AS n FROM summaries").get() as any).n).toBe(0);
  });
});
