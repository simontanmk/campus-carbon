import { Hono } from "hono";
import { award, claimBlocker, loadToken } from "../claims";
import { loadSettings } from "../db";
import type { AppEnv } from "../env";
import { fail, readBody } from "../http";
import { verify } from "../lib/token";

export const claim = new Hono<AppEnv>();

const INVALID = "This code isn't valid. Ask the stall for a new one.";

claim.post("/claim", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  if (!user) return fail(c, 401, "no_session", "Enter a display name first.");
  if (user.role !== "student") return fail(c, 403, "not_student", "Seller and admin accounts can't claim points.");

  const body = (await readBody(c)) as { t?: unknown };
  const id = await verify(body.t, c.env.TOKEN_SECRET);
  if (!id) return fail(c, 400, "invalid_token", INVALID);

  const tok = await loadToken(db, id);
  if (!tok || tok.method !== "qr") return fail(c, 400, "invalid_token", INVALID);
  const now = Date.now();
  const s = await loadSettings(db);
  const block = await claimBlocker(db, tok, user.id, now, s);
  if (block) return fail(c, ...block);
  const result = await award(db, tok, user.id, now, s, "qr");
  if (Array.isArray(result)) return fail(c, ...result);
  return c.json(result);
});
