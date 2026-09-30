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
