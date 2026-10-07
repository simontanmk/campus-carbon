import { describe, expect, it } from "vitest";
import { cookiesFrom, setup } from "./helpers/setup";

const PASS = "correct horse battery";

describe("POST /api/admin/login", () => {
  it("is switched off (404) unless a passcode of at least 12 characters is configured", async () => {
    for (const env of [{}, { ADMIN_PASSCODE: "short" }]) {
      const ctx = await setup(env);
      const res = await ctx.req("/api/admin/login", { body: { passcode: "short" } });
      expect(res.status).toBe(404);
    }
  });

  it("refuses a wrong passcode", async () => {
    const ctx = await setup({ ADMIN_PASSCODE: PASS });
    for (const passcode of ["correct horse battery!", "", 123, null]) {
      const res = await ctx.req("/api/admin/login", { body: { passcode } });
      expect(res.status).toBe(401);
      expect(res.headers.getSetCookie()).toEqual([]);
    }
  });

  it("signs this device in as the admin", async () => {
    const ctx = await setup({ ADMIN_PASSCODE: PASS });
    const res = await ctx.req("/api/admin/login", { body: { passcode: PASS } });
    expect(res.status).toBe(200);
    const me = (await ctx.req("/api/me", { cookie: cookiesFrom(res.headers) })).body;
    expect(me.user).toMatchObject({ id: "u-admin", role: "admin" });
    expect(me.can_switch).toBe(true);
  });
});
