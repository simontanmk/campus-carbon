import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { AppEnv, Role, User } from "./env";
import { fail } from "./http";
import { sign, verify } from "./lib/token";

const COOKIE_OPTS = { httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge: 60 * 60 * 24 * 365 } as const;

export const session = createMiddleware<AppEnv>(async (c, next) => {
  const db = c.env.DB;
  let user: User | null = null;
  const uid = await verify(getCookie(c, "uid"), c.env.COOKIE_SECRET);
  if (uid) {
    user = await db
      .prepare("SELECT id, display_name, role, stall_id FROM users WHERE id = ?")
      .bind(uid)
      .first<User>();
  }
  let adminId: string | null = user?.role === "admin" ? user.id : null;
  if (!adminId) {
    const adm = await verify(getCookie(c, "adm"), c.env.COOKIE_SECRET);
    if (adm) {
      const row = await db.prepare("SELECT id FROM users WHERE id = ? AND role = 'admin'").bind(adm).first();
      if (row) adminId = adm;
    }
  }
  c.set("user", user ?? null);
  c.set("adminId", adminId);
  await next();
});

export async function startSession(c: Context<AppEnv>, userId: string) {
  setCookie(c, "uid", await sign(userId, c.env.COOKIE_SECRET), COOKIE_OPTS);
}

export async function rememberAdmin(c: Context<AppEnv>, adminId: string) {
  setCookie(c, "adm", await sign(adminId, c.env.COOKIE_SECRET), COOKIE_OPTS);
}

export function requireRole(...roles: Role[]) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const user = c.get("user");
    if (!user) return fail(c, 401, "no_session", "Enter a display name first.");
    if (!roles.includes(user.role)) return fail(c, 403, "forbidden", "This account can't do that.");
    await next();
  });
}

export const requireSwitcher = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get("adminId")) return fail(c, 403, "forbidden", "Only admins can switch personas.");
  await next();
});
