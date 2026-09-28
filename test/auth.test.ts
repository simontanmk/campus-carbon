import { describe, expect, it } from "vitest";
import { cookiesFrom, setup } from "./helpers/setup";

describe("POST /api/session", () => {
  it("creates a student and sets a session cookie", async () => {
    const { req } = await setup();
    const res = await req("/api/session", { body: { display_name: "  Dana  " } });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ display_name: "Dana", role: "student", stall_id: null });
    const cookie = cookiesFrom(res.headers);
    expect(cookie).toMatch(/^uid=/);
    const me = await req("/api/me", { cookie });
    expect(me.body.user.display_name).toBe("Dana");
    expect(me.body.can_switch).toBe(false);
  });

  it.each([[""], ["   "], ["x".repeat(31)], [42], [undefined]])("rejects name %j", async (name) => {
    const { req } = await setup();
    const res = await req("/api/session", { body: { display_name: name } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_name");
  });
});

describe("GET /api/me", () => {
  it("returns null user without a cookie", async () => {
    const { req } = await setup();
    expect((await req("/api/me")).body).toEqual({ user: null, can_switch: false });
  });

  it("ignores a forged cookie", async () => {
    const { req } = await setup();
    const res = await req("/api/me", { cookie: "uid=u-admin.forgedsig" });
    expect(res.body.user).toBeNull();
  });

  it("admin can switch", async () => {
    const { req } = await setup();
    const res = await req("/api/me", { as: "u-admin" });
    expect(res.body.user.role).toBe("admin");
    expect(res.body.can_switch).toBe(true);
  });
});

describe("persona switcher", () => {
  it("admin impersonates a seller and can still switch back", async () => {
    const { req } = await setup();
    const imp = await req("/api/admin/impersonate", { as: "u-admin", body: { user_id: "u-seller-econ" } });
    expect(imp.status).toBe(200);
    expect(imp.body.user.id).toBe("u-seller-econ");
    const cookie = cookiesFrom(imp.headers);
    const me = await req("/api/me", { cookie });
    expect(me.body.user.id).toBe("u-seller-econ");
    expect(me.body.can_switch).toBe(true);
    const back = await req("/api/admin/impersonate", { cookie, body: { user_id: "u-admin" } });
    expect(back.body.user.id).toBe("u-admin");
  });

  it("students cannot list or impersonate", async () => {
    const { req } = await setup();
    expect((await req("/api/admin/users", { as: "u-alex" })).status).toBe(403);
    expect((await req("/api/admin/impersonate", { as: "u-alex", body: { user_id: "u-admin" } })).status).toBe(403);
  });

  it("lists users for the switcher", async () => {
    const { req } = await setup();
    const res = await req("/api/admin/users", { as: "u-admin" });
    expect(res.body.users.map((u: any) => u.id)).toEqual(
      expect.arrayContaining(["u-admin", "u-seller-econ", "u-alex"]),
    );
  });

  it("404s on an unknown user", async () => {
    const { req } = await setup();
    const res = await req("/api/admin/impersonate", { as: "u-admin", body: { user_id: "nope" } });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("no_user");
  });
});
