import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppEnv } from "../env";
import { fail, readBody } from "../http";
import { aiJson, aiLive } from "../lib/ai";
import { cleanParts, MEAL_PROMPT, mockMeal, mockNudge, mockTrip, NUDGE_PROMPT, TRIP_PROMPT, validateMeal, validateNudge, validateTrip } from "../lib/ai-tasks";
import { requireRole } from "../session";
import { insertCapped } from "../activities";
import { loadSettings } from "../db";
import { computeKg, isLowCarbonMeal, type FactorTable, type Parts } from "../lib/carbon";
import { decodeImage } from "../image";
import { sign, verify } from "../lib/token";
import { weekFacts } from "../facts";
import { sgDayStart, sgWeekStart } from "../lib/time";
import type { Context } from "hono";

export const ai = new Hono<AppEnv>();
const photoLimit = bodyLimit({
  maxSize: 3 * 1024 * 1024,
  onError: (c) => c.json({ error: "too_large", message: "That photo is too large. Try again; the app shrinks photos first." }, 413),
});
const student = requireRole("student");
const AI_LIMIT = "You've used today's AI help. Pick from the lists, or try again tomorrow.";

/** Takes one of the student's live AI calls for today (spec: protect the free Gemini quota). False when used up. */
async function takeAiCall(c: Context<AppEnv>): Promise<boolean> {
  if (!aiLive(c.env)) return true;
  const now = Date.now();
  const s = await loadSettings(c.env.DB);
  const r = await c.env.DB
    .prepare("INSERT INTO ai_calls (user_id, created_at) SELECT ?1, ?2 WHERE (SELECT COUNT(*) FROM ai_calls WHERE user_id = ?1 AND created_at >= ?3) < ?4")
    .bind(c.get("user")!.id, now, sgDayStart(now), s.ai_daily_max)
    .run();
  return r.meta.changes === 1;
}

ai.post("/trips/parse", student, async (c) => {
  const body = await readBody(c);
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (text.length < 1 || text.length > 200) return fail(c, 400, "invalid_text", "Type where you went, up to 200 characters.");
  if (!(await takeAiCall(c))) return fail(c, 429, "ai_limit", AI_LIMIT);
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

async function factorTable(db: D1Database): Promise<FactorTable> {
  const { results } = await db.prepare("SELECT key, kg_per_unit FROM factors WHERE unit = 'kg'").all<{ key: string; kg_per_unit: number | null }>();
  return Object.fromEntries(results.map((r) => [r.key, r.kg_per_unit]));
}

/** kg and low-carbon come only from the factor table and the §7 rule; empty parts never qualify. */
function assess(parts: Parts, factors: FactorTable) {
  const kg = Object.keys(parts).length ? computeKg(parts, factors) : null;
  const low = kg != null && isLowCarbonMeal(parts);
  return { kg_co2e: kg, low_carbon: low };
}

async function hashUsed(db: D1Database, hash: string) {
  return (await db.prepare("SELECT 1 AS x FROM activities WHERE image_hash = ?").bind(hash).first()) != null;
}

ai.post("/meals/photo", photoLimit, student, async (c) => {
  const db = c.env.DB;
  const img = await decodeImage((await readBody(c)).image);
  if ("error" in img) return fail(c, 400, "invalid_image", "Take a JPEG, PNG or WebP photo under 1.5 MB.");
  if (await hashUsed(db, img.hash)) return fail(c, 409, "duplicate_photo", "This photo has already been logged.");
  if (!(await takeAiCall(c))) return fail(c, 429, "ai_limit", "You've used today's AI photo checks. Scan the stall's code instead, or try again tomorrow.");
  const r = await aiJson(c.env, { instructions: MEAL_PROMPT, text: "What is this meal?", image: { mime: img.mime, base64: img.base64 } }, validateMeal, mockMeal, c.env.AI_FETCH);
  const [factors, s] = await Promise.all([factorTable(db), loadSettings(db)]);
  const a = assess(r.value.parts, factors);
  // The ticket binds this student, this photo and who answered; confirm can't be called without a real upload,
  // and an offline (mock) estimate never earns points: spec §7 pays only for AI-identified low-carbon meals.
  const ticket = await sign(`${c.get("user")!.id}:${img.hash}:${r.source}`, c.env.TOKEN_SECRET);
  return c.json({
    dish: r.value.dish, parts: r.value.parts, confidence: r.value.confidence, ...a,
    points: a.low_carbon && r.source === "live" ? s.points_photo_low_carbon : 0, image_hash: img.hash, source: r.source, ticket,
  });
});

ai.post("/meals/photo/confirm", student, async (c) => {
  const db = c.env.DB;
  const body = await readBody(c);
  const dish = typeof body.dish === "string" ? body.dish.trim() : "";
  const hash = typeof body.image_hash === "string" && /^[0-9a-f]{64}$/.test(body.image_hash) ? body.image_hash : null;
  const partsOk = body.parts && typeof body.parts === "object" && !Array.isArray(body.parts);
  if (dish.length < 1 || dish.length > 80 || !hash || !partsOk) return fail(c, 400, "invalid_meal", "Check the dish name and try again.");
  const uid = c.get("user")!.id;
  const ticket = await verify(body.ticket, c.env.TOKEN_SECRET);
  const source = ticket === `${uid}:${hash}:live` ? "live" : ticket === `${uid}:${hash}:mock` ? "mock" : null;
  if (!source) return fail(c, 400, "invalid_ticket", "Take the photo again, then log it.");
  if (await hashUsed(db, hash)) return fail(c, 409, "duplicate_photo", "This photo has already been logged.");
  const parts = cleanParts(body.parts);
  const [factors, s] = await Promise.all([factorTable(db), loadSettings(db)]);
  const a = assess(parts, factors);
  const full = a.low_carbon && source === "live" ? s.points_photo_low_carbon : 0;
  let points: number;
  try {
    points = await insertCapped(
      db,
      { user_id: uid, category: "food", type: "meal", kg_co2e: a.kg_co2e, source: "photo", low_carbon: a.low_carbon, image_hash: hash, detail: { dish, parts, ai: source } },
      full, s.self_reported_daily_cap, Date.now(),
    );
  } catch (e) {
    if (String(e).includes("UNIQUE")) return fail(c, 409, "duplicate_photo", "This photo has already been logged.");
    throw e;
  }
  return c.json({ points, capped: points < full, ...a }, 201);
});

ai.get("/me/nudge", student, async (c) => {
  const db = c.env.DB;
  const uid = c.get("user")!.id;
  const now = Date.now();
  const weekStart = sgWeekStart(now);
  const cached = await db.prepare("SELECT text FROM summaries WHERE user_id = ? AND week_start = ?").bind(uid, weekStart).first<{ text: string }>();
  if (cached) return c.json({ text: cached.text, source: "live" });
  const facts = await weekFacts(db, uid, now);
  // Nothing to personalise yet: the offline sentence, without spending one of the student's AI calls.
  if (facts.meals_week === 0 && facts.week_kg <= 0) return c.json({ text: mockNudge(facts).text, source: "mock" });
  const r = (await takeAiCall(c))
    ? await aiJson(c.env, { instructions: NUDGE_PROMPT, text: JSON.stringify(facts) }, validateNudge, () => mockNudge(facts), c.env.AI_FETCH)
    : { value: mockNudge(facts), source: "mock" as const };
  // An empty week's sentence would be stale after the first log, so only cache weeks with activity.
  if (r.source === "live" && (facts.meals_week > 0 || facts.week_kg > 0)) {
    await db.prepare("INSERT INTO summaries (user_id, week_start, text, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, week_start) DO NOTHING")
      .bind(uid, weekStart, r.value.text, now).run();
  }
  return c.json({ text: r.value.text, source: r.source });
});
