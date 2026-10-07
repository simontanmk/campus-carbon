import { describe, expect, it, vi } from "vitest";
import { toCsv } from "../src/worker/lib/csv";
import { parseSettings } from "../src/worker/lib/settings";
import { sgWeekStart } from "../src/worker/lib/time";
import { cookiesFrom, setup as baseSetup } from "./helpers/setup";

async function setup(overrides: Record<string, unknown> = {}) {
  const ctx = await baseSetup(overrides);
  ctx.raw.exec("DELETE FROM activities WHERE id LIKE 'seed-%'"); // keep limits independent of persona history
  return ctx;
}
type Ctx = Awaited<ReturnType<typeof setup>>;
const student = async (ctx: Ctx, name = "Minor") => (await ctx.req("/api/session", { body: { display_name: name } })).body.user.id as string;
const nfcToken = (ctx: Ctx, item_id = "veg-noodles") => ctx.req("/api/stall/tokens", { as: "u-seller-noodles", body: { item_id, method: "nfc" } });
const live = (content: string) => ({
  AI_MODE: "live", AI_BASE_URL: "https://ai.test/v1", AI_MODEL: "m", AI_API_KEY: "k",
  AI_FETCH: vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })),
});

describe("settings validation", () => {
  it("rejects Object prototype keys", async () => {
    const ctx = await setup();
    for (const k of ["toString", "constructor", "hasOwnProperty"]) {
      const res = await ctx.req("/api/admin/settings", { as: "u-admin", body: { values: { [k]: 5 } } });
      expect(res.status).toBe(400);
    }
    expect(Object.hasOwn(parseSettings([{ key: "toString", value: "5" }]), "toString")).toBe(false);
  });

  it.each([
    ["token_ttl_sec", 14],
    ["rate_daily_max", 0],
    ["rate_stall_window_min", -1],
  ])("rejects %s below its minimum (%i)", async (key, value) => {
    const ctx = await setup();
    const res = await ctx.req("/api/admin/settings", { as: "u-admin", body: { values: { [key]: value } } });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain(key === "token_ttl_sec" ? "15" : key === "rate_daily_max" ? "1" : "0");
  });

  it("accepts the minimums themselves", async () => {
    const ctx = await setup();
    const res = await ctx.req("/api/admin/settings", { as: "u-admin", body: { values: { token_ttl_sec: 15, rate_daily_max: 1 } } });
    expect(res.status).toBe(200);
  });
});

describe("CSV", () => {
  it("neutralises cells that start with a tab or carriage return", () => {
    expect(toCsv(["a"], [["\tcmd"]])).toBe("a\r\n'\tcmd\r\n");
    expect(toCsv(["a"], [["\r=1"]])).toBe("a\r\n\"'\r=1\"\r\n");
  });
});

describe("NFC: seller clears a wrong tapper", () => {
  it("frees the token for the next tap and tells the cleared student", async () => {
    const ctx = await setup();
    const wrong = await student(ctx, "Wrong");
    const right = await student(ctx, "Right");
    const t = (await nfcToken(ctx)).body;
    await ctx.req("/api/tap", { as: wrong, body: { stall_id: "noodles" } });
    const cleared = await ctx.req(`/api/stall/tokens/${t.id}/clear`, { as: "u-seller-noodles", body: {} });
    expect(cleared.status).toBe(200);
    expect((await ctx.req(`/api/stall/tokens/${t.id}`, { as: "u-seller-noodles" })).body.state).toBe("pending");
    const gone = await ctx.req(`/api/tap/${t.id}`, { as: wrong });
    expect(gone.status).toBe(404);
    expect(gone.body.message).toMatch(/cleared/i);
    expect((await ctx.req("/api/tap", { as: right, body: { stall_id: "noodles" } })).body.token_id).toBe(t.id);
  });

  it("only the token's own stall can clear it", async () => {
    const ctx = await setup();
    const t = (await nfcToken(ctx)).body;
    expect((await ctx.req(`/api/stall/tokens/${t.id}/clear`, { as: "u-seller-econ", body: {} })).status).toBe(404);
  });

  it("a student holds one pending tap at a time: tapping another stall releases the first", async () => {
    const ctx = await setup();
    ctx.raw.exec("UPDATE stalls SET verify_method='both'");
    const uid = await student(ctx);
    const a = (await nfcToken(ctx)).body;
    const b = (await ctx.req("/api/stall/tokens", { as: "u-seller-econ", body: { item_id: "econ-veg-egg", method: "nfc" } })).body;
    await ctx.req("/api/tap", { as: uid, body: { stall_id: "noodles" } });
    await ctx.req("/api/tap", { as: uid, body: { stall_id: "econ-rice" } });
    expect((await ctx.req(`/api/stall/tokens/${a.id}`, { as: "u-seller-noodles" })).body.state).toBe("pending");
    expect((await ctx.req(`/api/stall/tokens/${b.id}`, { as: "u-seller-econ" })).body.state).toBe("tapped");
  });

  it("confirm is refused once the stall is switched to QR only", async () => {
    const ctx = await setup();
    const uid = await student(ctx);
    const t = (await nfcToken(ctx)).body;
    await ctx.req("/api/tap", { as: uid, body: { stall_id: "noodles" } });
    ctx.raw.exec("UPDATE stalls SET verify_method='qr' WHERE id='noodles'");
    const res = await ctx.req(`/api/stall/tokens/${t.id}/confirm`, { as: "u-seller-noodles", body: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("method_off");
  });
});

describe("claims", () => {
  it("two codes from one stall claimed at the same moment award only one meal", async () => {
    const ctx = await setup();
    const uid = await student(ctx);
    const mk = async () => (await ctx.req("/api/stall/tokens", { as: "u-seller-econ", body: { item_id: "econ-veg-egg" } })).body.token;
    const [t1, t2] = [await mk(), await mk()];
    const res = await Promise.all([t1, t2].map((t) => ctx.req("/api/claim", { as: uid, body: { t } })));
    expect(res.map((r) => r.status).sort()).toEqual([200, 429]);
    expect((ctx.raw.prepare("SELECT COUNT(*) AS n FROM activities WHERE user_id=?").get(uid) as any).n).toBe(1);
  });

  it("token responses carry the server clock so the seller's countdown ignores device skew", async () => {
    const ctx = await setup();
    const before = Date.now();
    const t = (await ctx.req("/api/stall/tokens", { as: "u-seller-econ", body: { item_id: "econ-veg-egg" } })).body;
    expect(t.server_now).toBeGreaterThanOrEqual(before);
    expect(t.expires_at - t.server_now).toBe(90_000);
    const s = (await ctx.req(`/api/stall/tokens/${t.id}`, { as: "u-seller-econ" })).body;
    expect(s.server_now).toBeGreaterThanOrEqual(t.server_now);
  });
});

describe("AI daily limit per student", () => {
  it("stops live AI calls after ai_daily_max and says so", async () => {
    const env = live('{"from_id":"hive","to_id":"src"}');
    const ctx = await setup(env);
    ctx.raw.exec("INSERT INTO settings (key,value) VALUES ('ai_daily_max','2') ON CONFLICT(key) DO UPDATE SET value='2'");
    const uid = await student(ctx);
    for (let i = 0; i < 2; i++) expect((await ctx.req("/api/trips/parse", { as: uid, body: { text: "hive to src" } })).status).toBe(200);
    const third = await ctx.req("/api/trips/parse", { as: uid, body: { text: "hive to src" } });
    expect(third.status).toBe(429);
    expect(third.body.error).toBe("ai_limit");
    expect(env.AI_FETCH).toHaveBeenCalledTimes(2);
    // Another student still has their own allowance.
    expect((await ctx.req("/api/trips/parse", { as: await student(ctx, "Other"), body: { text: "hive to src" } })).status).toBe(200);
  });

  it("the nudge falls back to the offline sentence instead of failing", async () => {
    const env = live('{"text":"Nice week."}');
    const ctx = await setup(env);
    ctx.raw.exec("INSERT INTO settings (key,value) VALUES ('ai_daily_max','1') ON CONFLICT(key) DO UPDATE SET value='1'");
    const uid = await student(ctx);
    await ctx.req("/api/trips/parse", { as: uid, body: { text: "hive to src" } });
    const n = await ctx.req("/api/me/nudge", { as: uid });
    expect(n.status).toBe(200);
    expect(n.body.source).toBe("mock");
  });

  it("does not count calls when no live AI is configured", async () => {
    const ctx = await setup();
    ctx.raw.exec("INSERT INTO settings (key,value) VALUES ('ai_daily_max','1') ON CONFLICT(key) DO UPDATE SET value='1'");
    const uid = await student(ctx);
    for (let i = 0; i < 3; i++) expect((await ctx.req("/api/trips/parse", { as: uid, body: { text: "hive to src" } })).status).toBe(200);
  });
});

describe("menu import with the AI offline", () => {
  it("writes no mock drafts and says the AI is unavailable", async () => {
    const ctx = await setup();
    const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
    const before = (ctx.raw.prepare("SELECT COUNT(*) AS n FROM items").get() as any).n;
    const res = await ctx.req("/api/admin/menu/photo", { as: "u-admin", body: { stall_id: "econ-rice", image: { mime: "image/png", base64: PNG } } });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("ai_unavailable");
    expect((ctx.raw.prepare("SELECT COUNT(*) AS n FROM items").get() as any).n).toBe(before);
  });
});

describe("persona switching", () => {
  it("the switch capability lasts 12 hours and can be dropped", async () => {
    const ctx = await setup();
    const sw = await ctx.req("/api/admin/impersonate", { as: "u-admin", body: { user_id: "u-alex" } });
    const adm = sw.headers.getSetCookie().find((c) => c.startsWith("adm="))!;
    expect(adm).toContain("Max-Age=43200");
    const cookie = cookiesFrom(sw.headers);
    expect((await ctx.req("/api/me", { cookie })).body.can_switch).toBe(true);
    const stop = await ctx.req("/api/session/stop-switching", { cookie, body: {} });
    expect(stop.status).toBe(200);
    const after = [cookie.split("; ").find((c) => c.startsWith("uid="))!, cookiesFrom(stop.headers)].filter(Boolean).join("; ");
    const me = (await ctx.req("/api/me", { cookie: after })).body;
    expect(me.user.id).toBe("u-alex");
    expect(me.can_switch).toBe(false);
  });
});

describe("mission rewards apply from the week they change", () => {
  it("a new reward doesn't rewrite last week's totals", async () => {
    const ctx = await setup();
    const uid = await student(ctx);
    const lastWeek = sgWeekStart(Date.now()) - 3 * 86_400_000;
    ctx.raw.exec(`INSERT INTO activities (id,user_id,category,type,points,verified,source,created_at) VALUES ('b1','${uid}','waste','byo',15,1,'qr',${lastWeek})`);
    const before = (await ctx.req("/api/missions", { as: uid })).body;
    await ctx.req("/api/admin/settings", { as: "u-admin", body: { values: { "mission_points_weekly-byo": 200 } } });
    // Last week's standings (and so Carbon Champion) keep the 80-point reward.
    const champ = (await ctx.req("/api/missions", { as: uid })).body.badges.find((b: any) => b.id === "carbon-champion");
    expect(champ).toEqual(before.badges.find((b: any) => b.id === "carbon-champion"));
    const total = (await ctx.req("/api/me/summary", { as: uid })).body.points_total;
    expect(total).toBe(15 + 80);
    // This week's BYO earns the new reward.
    ctx.raw.exec(`INSERT INTO activities (id,user_id,category,type,points,verified,source,created_at) VALUES ('b2','${uid}','waste','byo',15,1,'qr',${Date.now() - 1000})`);
    const now = (await ctx.req("/api/me/summary", { as: uid })).body;
    expect(now.points_week).toBe(15 + 200);
    expect(now.points_total).toBe(15 + 80 + 15 + 200);
    expect((await ctx.req("/api/admin/settings", { as: "u-admin" })).body.missions.find((m: any) => m.id === "weekly-byo").points).toBe(200);
  });
});

describe("nudge on an empty week", () => {
  it("uses the offline sentence without spending an AI call", async () => {
    const env = live('{"text":"Nice week."}');
    const ctx = await setup(env);
    const uid = await student(ctx, "Empty");
    for (let i = 0; i < 3; i++) expect((await ctx.req("/api/me/nudge", { as: uid })).body.source).toBe("mock");
    expect(env.AI_FETCH).not.toHaveBeenCalled();
  });
});
