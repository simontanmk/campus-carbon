import { Hono } from "hono";
import type { AppEnv, User } from "../env";
import { fail, readBody } from "../http";
import { rememberAdmin, requireSwitcher, startSession } from "../session";

export const auth = new Hono<AppEnv>();

auth.post("/session", async (c) => {
  const body = (await readBody(c)) as { display_name?: unknown };
  const name = typeof body.display_name === "string" ? body.display_name.trim() : "";
  if (name.length < 1 || name.length > 30) {
    return fail(c, 400, "invalid_name", "Enter a name between 1 and 30 characters.");
  }
  const user: User = { id: crypto.randomUUID(), display_name: name, role: "student", stall_id: null };
  await c.env.DB.prepare("INSERT INTO users (id, display_name, role, created_at) VALUES (?, ?, 'student', ?)")
    .bind(user.id, name, Date.now())
    .run();
  await startSession(c, user.id);
  return c.json({ user }, 201);
});

auth.get("/me", (c) => c.json({ user: c.get("user"), can_switch: c.get("adminId") !== null }));

auth.get("/admin/users", requireSwitcher, async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, display_name, role, stall_id FROM users ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'seller' THEN 1 ELSE 2 END, display_name LIMIT 100",
  ).all<User>();
  return c.json({ users: results });
});

auth.post("/admin/impersonate", requireSwitcher, async (c) => {
  const body = (await readBody(c)) as { user_id?: unknown };
  const target =
    typeof body.user_id === "string"
      ? await c.env.DB.prepare("SELECT id, display_name, role, stall_id FROM users WHERE id = ?")
          .bind(body.user_id)
          .first<User>()
      : null;
  if (!target) return fail(c, 404, "no_user", "That user doesn't exist.");
  await rememberAdmin(c, c.get("adminId")!);
  await startSession(c, target.id);
  return c.json({ user: target });
});
