import { Hono } from "hono";
import type { AppEnv } from "../env";
import { fail, readBody } from "../http";
import { aiJson } from "../lib/ai";
import { mockTrip, TRIP_PROMPT, validateTrip } from "../lib/ai-tasks";
import { requireRole } from "../session";

export const ai = new Hono<AppEnv>();
const student = requireRole("student");

ai.post("/trips/parse", student, async (c) => {
  const body = await readBody(c);
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (text.length < 1 || text.length > 200) return fail(c, 400, "invalid_text", "Type where you went, up to 200 characters.");
  const { results: places } = await c.env.DB.prepare("SELECT id, name FROM locations ORDER BY name").all<{ id: string; name: string }>();
  const r = await aiJson(
    c.env,
    { instructions: TRIP_PROMPT(places), text },
    validateTrip(places.map((p) => p.id)),
    () => mockTrip(text, places),
    c.env.AI_FETCH,
  );
  const { from_id, to_id } = r.value;
  if (!from_id || !to_id || from_id === to_id) {
    return fail(c, 422, "no_match", "Couldn't tell both places. Pick them from the lists instead.");
  }
  return c.json({ from_id, to_id, source: r.source });
});
