# Stage 3: AI Features — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four AI features from spec §9:
1. Menu photo → draft items for admin approval.
2. Typed trip ("Hive to Hall 11") → trip options.
3. Meal photo at a stall that isn't onboarded → unverified +5 entry.
4. A weekly nudge sentence on Today.

All four run on Gemini through its OpenAI-compatible API, and a mock backend keeps the demo working if Gemini fails.

**Architecture:**
- **AI client** (`src/worker/lib/ai.ts`): one `aiJson` call. It tries `AI_MODEL`, then `AI_FALLBACK_MODEL`, then the feature's mock, and reports which one answered.
- **Pure per-feature module** (`src/worker/lib/ai-tasks.ts`): prompts, strict validators and mocks.
- **AI never produces kg or the low-carbon flag.** Validators keep only ingredient keys from the factor table. The existing `carbon` module computes kg, and the §7 rule decides low-carbon.
- **Tests** inject a fake `fetch`, so they never call Gemini.

**Tech Stack:** as before. Gemini via `https://generativelanguage.googleapis.com/v1beta/openai/` (chat completions, `response_format: json_object`, `image_url` data URLs). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-29-campus-carbon-app-design.md` (§7, §9, §10)

**Follows:** Stage 2 (merged). **Next:** Stage 4 (NFC, CSV export, admin settings, polish).

## Global Constraints

- **AI output is only:**
  - dish names
  - ingredient grams, restricted to the kg factor keys: `rice, wheat, poultry, pork, beef_herd, beef_dairy, fish_farmed, eggs, tofu, milk, coffee, cane_sugar, veg`
  - place ids from `locations`
  - one short sentence of text
- **Unknown keys are dropped.** Grams must be > 0 and ≤ 1000.
- **Empty or unestimable parts** → `kg_co2e = null`, not low-carbon, 0 points.
- **Photo meals** (spec §9.2.3):
  - saved as `verified = 0`, `source = 'photo'`, `category = 'food'`, `type = 'meal'`
  - +`points_photo_low_carbon` (5) only if low-carbon
  - counts toward the 30/day self-reported cap
  - `image_hash` = SHA-256 of the image bytes; a duplicate returns 409
  - images are never stored (spec §9 privacy)
- **Menu items from photos** are inserted as `status = 'draft'` and only go live when an admin approves.
- **Typed trips** map only to existing location ids. Anything else is `422 no_match`, and the app keeps the dropdowns.
- **AI config** (wrangler `vars`, not secret):
  - `AI_MODE = "live"`
  - `AI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"`
  - `AI_MODEL = "gemini-flash-lite-latest"`
  - `AI_FALLBACK_MODEL = "gemini-3.8-flash"`
- **The key is the `AI_API_KEY` secret**, already set live and in `.dev.vars`. Never log, print or commit it.
- **Tests run with no `AI_MODE`**, which means mock.
- **Timeout** is 8 s per model attempt. After two failed attempts, the mock answers and the response says `source: "mock"`. The UI then shows "offline estimate".
- **Nudges are cached** in `summaries` per user per week, and only when the source is `live`.
- **Errors:** every error is `{ error, message }`. No 500s for bad input.

## Review Focus

1. **The AI returns unknown ingredient keys, negative or huge grams, or no parts.** Unknown keys and bad grams are dropped. kg comes only from factors. Empty parts give kg `null`, not low-carbon, 0 points. Pinned in Tasks 2 and 5.
2. **Gemini returns 503, times out, returns non-JSON, or JSON of the wrong shape.** The mock answers with `source: "mock"`, never a 500. Pinned in Tasks 1 and 4.
3. **The same photo is analysed or confirmed twice.** Both routes return `409 duplicate_photo`. Pinned in Task 5.
4. **A typed trip naming one place, an unknown place, or the same place twice.** Returns `422 no_match`. Pinned in Task 4.
5. **Photo-meal points past the daily cap.** Capped. Verified stall claims are unaffected. Pinned in Task 5.
6. **Uploads that aren't images, are too large, or have malformed base64.** Returns 400, not 500. Pinned in Tasks 5 and 6.

---

## File Structure

```
src/worker/lib/ai.ts              aiJson (client with model fallback + mock)
src/worker/lib/ai-tasks.ts        prompts, validators, mocks for trip / meal / menu / nudge
src/worker/activities.ts          (modify) insertCapped moved here and generalised
src/worker/routes/log.ts          (modify) use shared insertCapped
src/worker/image.ts               decodeImage (validate + bytes + sha256)
src/worker/facts.ts               weekFacts (numbers for the nudge)
src/worker/routes/ai.ts           /trips/parse, /meals/photo, /meals/photo/confirm, /me/nudge
src/worker/routes/admin-menu.ts   /admin/stalls, /admin/items, /admin/menu/photo, item edit/approve/delete
src/worker/env.ts                 (modify) AI bindings
src/worker/app.ts                 (modify) mount routes
wrangler.jsonc                    (modify) AI vars
src/app/image.ts                  resizeToJpeg (canvas, max 1024 px)
src/app/screens/Log.tsx           (modify) typed trip, meal photo
src/app/screens/Home.tsx          (modify) nudge line
src/app/screens/MenuImport.tsx    admin menu-photo import and draft review
src/app/screens/Admin.tsx         (modify) link to menu import
src/app/App.tsx                   (modify) /admin/menu route
test/ai.test.ts, test/ai-tasks.test.ts, test/ai-routes.test.ts, test/admin-menu.test.ts
```

---

### Task 1: AI client with fallback

**Files:**
- Create: `src/worker/lib/ai.ts`, `test/ai.test.ts`

**Interfaces:**
- Produces:
  - `type AiEnv = { AI_MODE?: string; AI_BASE_URL?: string; AI_MODEL?: string; AI_FALLBACK_MODEL?: string; AI_API_KEY?: string }`
  - `type AiRequest = { instructions: string; text: string; image?: { mime: string; base64: string } }`
  - `aiJson<T>(env: AiEnv, req: AiRequest, validate: (raw: unknown) => T | null, mock: () => T, fetchImpl?: typeof fetch): Promise<{ value: T; source: "live" | "mock" }>`

- [ ] **Step 1: Write the failing test** `test/ai.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";
import { aiJson } from "../src/worker/lib/ai";

const env = { AI_MODE: "live", AI_BASE_URL: "https://ai.test/v1/", AI_MODEL: "primary", AI_FALLBACK_MODEL: "backup", AI_API_KEY: "k" };
const isOk = (raw: unknown) => (raw && typeof raw === "object" && (raw as any).ok === true ? (raw as { ok: true }) : null);
const mock = () => ({ ok: true as const, mock: true });
const reply = (content: string, status = 200) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status, headers: { "content-type": "application/json" } });

describe("aiJson", () => {
  it("uses the mock when AI_MODE is not live, without calling fetch", async () => {
    const f = vi.fn();
    expect(await aiJson({}, { instructions: "i", text: "t" }, isOk, mock, f)).toEqual({ value: { ok: true, mock: true }, source: "mock" });
    expect(f).not.toHaveBeenCalled();
  });

  it("uses the mock when the key is missing", async () => {
    const f = vi.fn();
    expect((await aiJson({ ...env, AI_API_KEY: "" }, { instructions: "i", text: "t" }, isOk, mock, f)).source).toBe("mock");
    expect(f).not.toHaveBeenCalled();
  });

  it("returns the primary model's validated JSON", async () => {
    const f = vi.fn(async () => reply('{"ok":true}'));
    expect(await aiJson(env, { instructions: "i", text: "t" }, isOk, mock, f as any)).toEqual({ value: { ok: true }, source: "live" });
    const [url, init] = f.mock.calls[0] as any;
    expect(url).toBe("https://ai.test/v1/chat/completions");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("primary");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(init.headers.authorization).toBe("Bearer k");
  });

  it("sends an image as a data URL next to the text", async () => {
    const f = vi.fn(async () => reply('{"ok":true}'));
    await aiJson(env, { instructions: "i", text: "t", image: { mime: "image/jpeg", base64: "QUJD" } }, isOk, mock, f as any);
    const user = JSON.parse((f.mock.calls[0] as any)[1].body).messages[1];
    expect(user.content).toEqual([{ type: "text", text: "t" }, { type: "image_url", image_url: { url: "data:image/jpeg;base64,QUJD" } }]);
  });

  it("falls back to the second model on a 503", async () => {
    const f = vi.fn().mockResolvedValueOnce(reply("{}", 503)).mockResolvedValueOnce(reply('{"ok":true}'));
    expect((await aiJson(env, { instructions: "i", text: "t" }, isOk, mock, f as any)).source).toBe("live");
    expect(JSON.parse((f.mock.calls[1] as any)[1].body).model).toBe("backup");
  });

  it("strips a ```json fence", async () => {
    const f = vi.fn(async () => reply('```json\n{"ok":true}\n```'));
    expect((await aiJson(env, { instructions: "i", text: "t" }, isOk, mock, f as any)).source).toBe("live");
  });

  it.each([
    ["non-JSON", () => reply("sure! here you go")],
    ["wrong shape", () => reply('{"ok":"yes"}')],
    ["network error", () => Promise.reject(new Error("boom"))],
    ["empty body", () => Promise.resolve(new Response("", { status: 200 }))],
  ])("falls back to the mock after both models fail (%s)", async (_n, make) => {
    const f = vi.fn(make as any);
    expect(await aiJson(env, { instructions: "i", text: "t" }, isOk, mock, f as any)).toEqual({ value: { ok: true, mock: true }, source: "mock" });
    expect(f).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/ai.test.ts`
Expected: FAIL, "Cannot find module"

- [ ] **Step 3: Implement** `src/worker/lib/ai.ts`

```ts
export type AiEnv = { AI_MODE?: string; AI_BASE_URL?: string; AI_MODEL?: string; AI_FALLBACK_MODEL?: string; AI_API_KEY?: string };
export type AiRequest = { instructions: string; text: string; image?: { mime: string; base64: string } };

const TIMEOUT_MS = 8000;

function stripFence(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

/**
 * One JSON-producing AI call. Tries AI_MODEL, then AI_FALLBACK_MODEL; any failure (HTTP error, timeout,
 * non-JSON, or a shape `validate` rejects) moves on. If nothing valid comes back, returns the mock.
 */
export async function aiJson<T>(
  env: AiEnv,
  req: AiRequest,
  validate: (raw: unknown) => T | null,
  mock: () => T,
  fetchImpl: typeof fetch = fetch,
): Promise<{ value: T; source: "live" | "mock" }> {
  if (env.AI_MODE !== "live" || !env.AI_API_KEY || !env.AI_BASE_URL) return { value: mock(), source: "mock" };
  const url = `${env.AI_BASE_URL.replace(/\/+$/, "")}/chat/completions`;
  const user = req.image
    ? [{ type: "text", text: req.text }, { type: "image_url", image_url: { url: `data:${req.image.mime};base64,${req.image.base64}` } }]
    : req.text;
  for (const model of [env.AI_MODEL, env.AI_FALLBACK_MODEL].filter((m): m is string => !!m)) {
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { authorization: `Bearer ${env.AI_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({
          model,
          response_format: { type: "json_object" },
          messages: [{ role: "system", content: req.instructions }, { role: "user", content: user }],
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const body = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
      const content = body.choices?.[0]?.message?.content;
      if (typeof content !== "string") continue;
      const value = validate(JSON.parse(stripFence(content)));
      if (value !== null) return { value, source: "live" };
    } catch {
      // timeout, network error or bad JSON: try the next model
    }
  }
  return { value: mock(), source: "mock" };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run test/ai.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/worker/lib/ai.ts test/ai.test.ts
git commit -m "feat(ai): JSON client with model fallback and mock"
```

---

### Task 2: Per-feature prompts, validators and mocks

**Files:**
- Create: `src/worker/lib/ai-tasks.ts`, `test/ai-tasks.test.ts`

**Interfaces:**
- Consumes: `type Parts` (Stage 1 carbon)
- Produces:
  - `FACTOR_KEYS: readonly string[]`
  - `cleanParts(raw: unknown): Parts`
  - `TRIP_PROMPT(places: {id,name}[]): string`
  - `validateTrip(ids: string[]): (raw) => { from_id: string | null; to_id: string | null } | null`
  - `mockTrip(text, places): { from_id: string | null; to_id: string | null }`
  - `MEAL_PROMPT: string`
  - `validateMeal: (raw) => { dish: string; parts: Parts; confidence: number } | null`
  - `mockMeal(): same`
  - `MENU_PROMPT: string`
  - `validateMenu: (raw) => { items: { name: string; kind: "meal" | "drink"; parts: Parts }[] } | null`
  - `mockMenu(): same`
  - `type NudgeFacts` (below)
  - `NUDGE_PROMPT: string`
  - `validateNudge: (raw) => { text: string } | null`
  - `mockNudge(f: NudgeFacts): { text: string }`

```ts
type NudgeFacts = {
  first_name: string;
  week_kg: number;
  meals_week: number;
  low_carbon_meals_week: number;
  biggest: "food" | "mobility" | "waste" | null;
  swap: { from: string; to: string; saves_kg: number } | null;
};
```

- [ ] **Step 1: Write the failing test** `test/ai-tasks.test.ts`

```ts
import { describe, expect, it } from "vitest";
import {
  cleanParts, mockMeal, mockMenu, mockNudge, mockTrip, validateMeal, validateMenu, validateNudge, validateTrip,
} from "../src/worker/lib/ai-tasks";

const places = [
  { id: "hive", name: "The Hive" },
  { id: "hall-11", name: "Hall 11" },
  { id: "north-spine", name: "North Spine" },
  { id: "src", name: "Sports and Recreation Centre" },
];

describe("cleanParts", () => {
  it("keeps only factor keys with 0 < grams <= 1000, rounded", () => {
    expect(cleanParts({ rice: 80.4, veg: 150, chilli: 10, pork: -5, tofu: 5000, eggs: "50", wheat: 0 })).toEqual({ rice: 80, veg: 150 });
  });
  it("returns {} for non-objects", () => {
    expect(cleanParts(null)).toEqual({});
    expect(cleanParts([1, 2])).toEqual({});
    expect(cleanParts("rice")).toEqual({});
  });
});

describe("trip", () => {
  const v = validateTrip(places.map((p) => p.id));
  it("accepts known ids", () => expect(v({ from_id: "hive", to_id: "hall-11" })).toEqual({ from_id: "hive", to_id: "hall-11" }));
  it("turns unknown ids into null", () => expect(v({ from_id: "hive", to_id: "mars" })).toEqual({ from_id: "hive", to_id: null }));
  it("rejects a non-object", () => expect(v("hive")).toBeNull());
  it("mock matches names and ids in the order they appear", () => {
    expect(mockTrip("from hall 11 to the hive please", places)).toEqual({ from_id: "hall-11", to_id: "hive" });
    expect(mockTrip("Hive → North Spine", places)).toEqual({ from_id: "hive", to_id: "north-spine" });
    expect(mockTrip("to the sports and recreation centre", places)).toEqual({ from_id: "src", to_id: null });
    expect(mockTrip("going somewhere", places)).toEqual({ from_id: null, to_id: null });
  });
});

describe("meal", () => {
  it("accepts a dish with cleaned parts and clamps confidence", () => {
    expect(validateMeal({ dish: " Veg noodles ", parts: { wheat: 100, chilli: 3 }, confidence: 1.4 })).toEqual({ dish: "Veg noodles", parts: { wheat: 100 }, confidence: 1 });
  });
  it("rejects a missing or empty dish", () => {
    expect(validateMeal({ dish: "", parts: {} })).toBeNull();
    expect(validateMeal({ parts: { rice: 80 } })).toBeNull();
  });
  it("mock is a valid meal", () => expect(validateMeal(mockMeal())).not.toBeNull());
});

describe("menu", () => {
  it("accepts up to 30 items, defaulting kind to meal and dropping nameless ones", () => {
    const r = validateMenu({ items: [{ name: "Kopi", kind: "drink", parts: { coffee: 10, milk: 50 } }, { name: "Fried rice", parts: { rice: 80 } }, { parts: {} }] });
    expect(r).toEqual({ items: [{ name: "Kopi", kind: "drink", parts: { coffee: 10, milk: 50 } }, { name: "Fried rice", kind: "meal", parts: { rice: 80 } }] });
  });
  it("rejects no items", () => {
    expect(validateMenu({ items: [] })).toBeNull();
    expect(validateMenu({})).toBeNull();
  });
  it("caps at 30 items", () => {
    const items = Array.from({ length: 40 }, (_, i) => ({ name: `Dish ${i}`, parts: { rice: 80 } }));
    expect(validateMenu({ items })!.items).toHaveLength(30);
  });
  it("mock is a valid menu", () => expect(validateMenu(mockMenu())).not.toBeNull());
});

describe("nudge", () => {
  it("accepts 1–400 characters of text", () => {
    expect(validateNudge({ text: "  Nice week.  " })).toEqual({ text: "Nice week." });
    expect(validateNudge({ text: "" })).toBeNull();
    expect(validateNudge({ text: "x".repeat(401) })).toBeNull();
  });
  it("mock mentions the biggest source and the swap", () => {
    const t = mockNudge({ first_name: "Alex", week_kg: 4.2, meals_week: 3, low_carbon_meals_week: 1, biggest: "food", swap: { from: "Chicken rice", to: "Vegetarian noodles with tofu", saves_kg: 0.97 } }).text;
    expect(t).toContain("4.2 kg");
    expect(t).toContain("food");
    expect(t).toContain("0.97 kg");
  });
  it("mock copes with an empty week", () => {
    expect(mockNudge({ first_name: "Bea", week_kg: 0, meals_week: 0, low_carbon_meals_week: 0, biggest: null, swap: null }).text.length).toBeGreaterThan(10);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/ai-tasks.test.ts`
Expected: FAIL, "Cannot find module"

- [ ] **Step 3: Implement** `src/worker/lib/ai-tasks.ts`

```ts
import type { Parts } from "./carbon";

export const FACTOR_KEYS = ["rice", "wheat", "poultry", "pork", "beef_herd", "beef_dairy", "fish_farmed", "eggs", "tofu", "milk", "coffee", "cane_sugar", "veg"] as const;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max: number) => (typeof v === "string" && v.trim().length > 0 && v.trim().length <= max ? v.trim() : null);

export function cleanParts(raw: unknown): Parts {
  if (!isObj(raw)) return {};
  const out: Parts = {};
  for (const k of FACTOR_KEYS) {
    const g = raw[k];
    if (typeof g === "number" && Number.isFinite(g) && g > 0 && g <= 1000) out[k] = Math.round(g);
  }
  return out;
}

const PARTS_RULES = `Ingredient keys allowed (grams, dry weight for rice and noodles): ${FACTOR_KEYS.join(", ")}. "veg" covers all vegetables. Use beef_dairy for beef unless told otherwise. Omit anything else (oil, sauce, spices). Do not estimate carbon.`;

// Trip -----------------------------------------------------------------------------------------
export const TRIP_PROMPT = (places: { id: string; name: string }[]) =>
  `You map a student's sentence about a campus trip to place ids. Places: ${places.map((p) => `${p.id} = ${p.name}`).join("; ")}. ` +
  `Reply only with JSON {"from_id": string|null, "to_id": string|null}. Use null when a place is not in the list or not mentioned.`;

export const validateTrip = (ids: string[]) => (raw: unknown) => {
  if (!isObj(raw)) return null;
  const pick = (v: unknown) => (typeof v === "string" && ids.includes(v) ? v : null);
  return { from_id: pick(raw.from_id), to_id: pick(raw.to_id) };
};

export function mockTrip(text: string, places: { id: string; name: string }[]) {
  const t = text.toLowerCase();
  const hits = places
    .map((p) => {
      const names = [p.name.toLowerCase(), p.name.toLowerCase().replace(/^the /, ""), p.id.replace(/-/g, " ")];
      const at = Math.min(...names.map((n) => t.indexOf(n)).filter((i) => i >= 0));
      return { id: p.id, at };
    })
    .filter((h) => Number.isFinite(h.at))
    .sort((a, b) => a.at - b.at);
  return { from_id: hits[0]?.id ?? null, to_id: hits[1]?.id ?? null };
}

// Meal photo -----------------------------------------------------------------------------------
export const MEAL_PROMPT =
  `You identify one hawker or canteen meal in Singapore from a photo. ${PARTS_RULES} ` +
  `Reply only with JSON {"dish": string, "parts": {key: grams}, "confidence": number between 0 and 1}.`;

export function validateMeal(raw: unknown) {
  if (!isObj(raw)) return null;
  const dish = str(raw.dish, 80);
  if (!dish) return null;
  const c = typeof raw.confidence === "number" && Number.isFinite(raw.confidence) ? Math.min(1, Math.max(0, raw.confidence)) : 0.5;
  return { dish, parts: cleanParts(raw.parts), confidence: c };
}

export const mockMeal = () => ({ dish: "Vegetarian noodles with tofu", parts: { wheat: 100, veg: 100, tofu: 60 }, confidence: 0.5 });

// Menu photo -----------------------------------------------------------------------------------
export const MENU_PROMPT =
  `You read a Singapore canteen stall's menu board from a photo and list each dish or drink with a typical portion's ingredients. ${PARTS_RULES} ` +
  `Reply only with JSON {"items": [{"name": string, "kind": "meal" | "drink", "parts": {key: grams}}]}.`;

export function validateMenu(raw: unknown) {
  if (!isObj(raw) || !Array.isArray(raw.items)) return null;
  const items = raw.items
    .filter(isObj)
    .map((i) => ({ name: str(i.name, 80), kind: i.kind === "drink" ? ("drink" as const) : ("meal" as const), parts: cleanParts(i.parts) }))
    .filter((i): i is { name: string; kind: "meal" | "drink"; parts: Parts } => i.name !== null)
    .slice(0, 30);
  return items.length ? { items } : null;
}

export const mockMenu = () => ({
  items: [
    { name: "Vegetable fried rice with egg", kind: "meal" as const, parts: { rice: 80, veg: 100, eggs: 50 } },
    { name: "Chicken cutlet rice", kind: "meal" as const, parts: { rice: 80, poultry: 100, veg: 30 } },
  ],
});

// Weekly nudge ---------------------------------------------------------------------------------
export type NudgeFacts = {
  first_name: string;
  week_kg: number;
  meals_week: number;
  low_carbon_meals_week: number;
  biggest: "food" | "mobility" | "waste" | null;
  swap: { from: string; to: string; saves_kg: number } | null;
};

export const NUDGE_PROMPT =
  `You write one or two short, warm, specific sentences for a university student about their week's food and travel footprint. ` +
  `Use only the numbers given; do not invent facts or numbers. No emoji, no exclamation marks. Reply only with JSON {"text": string}.`;

export function validateNudge(raw: unknown) {
  if (!isObj(raw)) return null;
  const text = str(raw.text, 400);
  return text ? { text } : null;
}

export function mockNudge(f: NudgeFacts): { text: string } {
  if (f.week_kg === 0 && f.meals_week === 0) return { text: "Nothing logged yet this week. Scan a stall's code after your next meal to get started." };
  const lead = `You've logged ${f.week_kg} kg CO₂e this week${f.biggest ? `, mostly from ${f.biggest}` : ""}.`;
  const swap = f.swap ? ` Swapping ${f.swap.from.toLowerCase()} for ${f.swap.to.toLowerCase()} next time saves ${f.swap.saves_kg} kg.` : "";
  return { text: lead + swap };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run test/ai-tasks.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/worker/lib/ai-tasks.ts test/ai-tasks.test.ts
git commit -m "feat(ai): prompts, strict validators and mocks per feature"
```

---

### Task 3: Share the capped insert

**Files:**
- Modify: `src/worker/activities.ts`, `src/worker/routes/log.ts`

**Interfaces:**
- Produces: `insertCapped(db, a: { user_id: string; category: "food" | "mobility" | "waste"; type: "meal" | "trip" | "container_return"; kg_co2e: number | null; detail: Record<string, unknown>; source?: "manual" | "photo"; low_carbon?: boolean | null; image_hash?: string | null }, full: number, cap: number, now: number): Promise<number>`, exported from `activities.ts`. It behaves exactly as Stage 2a's private version, plus the optional fields.

- [ ] **Step 1: Refactor.** Move `insertCapped` from `src/worker/routes/log.ts` into `src/worker/activities.ts` as below. Delete it from `log.ts` and import it there (`import { insertActivity, insertCapped } from "../activities";`). Also move `import { sgDayStart } from "./lib/time";` into `activities.ts`.

```ts
/**
 * Inserts a self-reported activity with its points capped against what the student has
 * already earned today, in one statement, so concurrent requests can't both slip under the cap.
 * Returns the points actually awarded.
 */
export async function insertCapped(
  db: D1Database,
  a: {
    user_id: string;
    category: "food" | "mobility" | "waste";
    type: "meal" | "trip" | "container_return";
    kg_co2e: number | null;
    detail: Record<string, unknown>;
    source?: "manual" | "photo";
    low_carbon?: boolean | null;
    image_hash?: string | null;
  },
  full: number,
  cap: number,
  now: number,
): Promise<number> {
  const points = await db
    .prepare(
      `INSERT INTO activities (id, user_id, category, type, kg_co2e, points, verified, source, low_carbon, image_hash, detail_json, created_at)
       SELECT ?1, ?2, ?3, ?4, ?5,
              MAX(0, MIN(?6, ?7 - COALESCE((SELECT SUM(points) FROM activities WHERE user_id = ?2 AND verified = 0 AND created_at >= ?8), 0))),
              0, ?9, ?10, ?11, ?12, ?13
       RETURNING points`,
    )
    .bind(
      crypto.randomUUID(), a.user_id, a.category, a.type, a.kg_co2e, full, cap, sgDayStart(now),
      a.source ?? "manual", a.low_carbon == null ? null : a.low_carbon ? 1 : 0, a.image_hash ?? null, JSON.stringify(a.detail), now,
    )
    .first<number>("points");
  return points ?? 0;
}
```

- [ ] **Step 2: Run all tests.** This is a pure refactor, so the existing log tests are the check.

Run: `npx vitest run && npm run typecheck`
Expected: all PASS (including "two simultaneous logs cannot push the day past the cap") and no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/worker/activities.ts src/worker/routes/log.ts
git commit -m "refactor: share the atomic capped insert"
```

---

### Task 4: Typed trip endpoint

**Files:**
- Create: `src/worker/routes/ai.ts`, `test/ai-routes.test.ts`
- Modify: `src/worker/env.ts`, `src/worker/app.ts`, `test/helpers/setup.ts`

**Interfaces:**
- Consumes: `aiJson` (Task 1), `TRIP_PROMPT`, `validateTrip`, `mockTrip` (Task 2)
- Produces:
  - `Bindings` gains the optional AI fields
  - `setup(envOverrides?)` accepts env overrides, and `setup().fetchCalls` records AI fetches when a fake is given
  - `POST /api/trips/parse { text }` → 200 `{ from_id, to_id, source }` | `400 invalid_text` | `422 no_match`

- [ ] **Step 1: Let tests inject env and a fake fetch.** In `test/helpers/setup.ts`:
  - change the signature to `export async function setup(overrides: Record<string, unknown> = {})`
  - build `const env = { DB: d1, TOKEN_SECRET: "test-token-secret", COOKIE_SECRET: "test-cookie-secret", ...overrides };`

  In `src/worker/env.ts`, extend `Bindings`:
```ts
export type Bindings = {
  DB: D1Database;
  TOKEN_SECRET: string;
  COOKIE_SECRET: string;
  AI_MODE?: string;
  AI_BASE_URL?: string;
  AI_MODEL?: string;
  AI_FALLBACK_MODEL?: string;
  AI_API_KEY?: string;
  /** Test seam: replaces global fetch for AI calls. */
  AI_FETCH?: typeof fetch;
};
```

- [ ] **Step 2: Write the failing test** `test/ai-routes.test.ts`

```ts
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
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run test/ai-routes.test.ts`
Expected: FAIL (404s)

- [ ] **Step 4: Implement** `src/worker/routes/ai.ts` (Tasks 5 and 7 extend this file)

```ts
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
```

Modify `src/worker/app.ts`: `import { ai } from "./routes/ai";` and `app.route("/", ai);`, placed right after `app.route("/", me);`.

- [ ] **Step 5: Run all tests**

Run: `npx vitest run && npm run typecheck`
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add src/worker test/helpers/setup.ts test/ai-routes.test.ts
git commit -m "feat(ai): typed trip to place ids"
```

---

### Task 5: Meal photo, analyse and confirm

**Files:**
- Create: `src/worker/image.ts`
- Modify: `src/worker/routes/ai.ts`, `test/ai-routes.test.ts`

**Interfaces:**
- Consumes:
  - `aiJson`, `MEAL_PROMPT`, `validateMeal`, `mockMeal`, `cleanParts`
  - `computeKg`, `isLowCarbonMeal` (Stage 1)
  - `insertCapped` (Task 3), `loadSettings`
- Produces:
  - `decodeImage(raw: unknown): Promise<{ mime: string; base64: string; hash: string } | { error: string }>`
  - `POST /api/meals/photo { image: { mime, base64 } }` → 200 `{ dish, parts, kg_co2e, low_carbon, points, image_hash, confidence, source }`
  - `POST /api/meals/photo/confirm { dish, parts, image_hash }` → 201 `{ points, capped, kg_co2e, low_carbon }`
  - errors:
    - `400 invalid_image`
    - `400 invalid_meal`
    - `409 duplicate_photo`

- [ ] **Step 1: Write the failing tests** (append to `test/ai-routes.test.ts`)

```ts
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
```

The live test expects 1.34 kg for chicken rice with rice 80 g and poultry 100 g and no veg: 80 × 4.45 / 1000 + 100 × 9.87 / 1000 = 0.356 + 0.987 = 1.343, which rounds to 1.34.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run test/ai-routes.test.ts`
Expected: the new tests FAIL (404s)

- [ ] **Step 3: Implement**

`src/worker/image.ts`:
```ts
const MIMES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BASE64 = 2_000_000; // ~1.5 MB of image; the app resizes to 1024 px JPEG first

/** Validates an uploaded image and returns its bytes' SHA-256. The image itself is never stored. */
export async function decodeImage(raw: unknown): Promise<{ mime: string; base64: string; hash: string } | { error: string }> {
  if (!raw || typeof raw !== "object") return { error: "invalid" };
  const { mime, base64 } = raw as { mime?: unknown; base64?: unknown };
  if (typeof mime !== "string" || !MIMES.includes(mime)) return { error: "invalid" };
  if (typeof base64 !== "string" || base64.length === 0 || base64.length > MAX_BASE64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return { error: "invalid" };
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
  } catch {
    return { error: "invalid" };
  }
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { mime, base64, hash };
}
```

Append to `src/worker/routes/ai.ts`:
```ts
import { insertCapped } from "../activities";
import { loadSettings } from "../db";
import { cleanParts, MEAL_PROMPT, mockMeal, validateMeal } from "../lib/ai-tasks";
import { computeKg, isLowCarbonMeal, type FactorTable, type Parts } from "../lib/carbon";
import { decodeImage } from "../image";

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

ai.post("/meals/photo", student, async (c) => {
  const db = c.env.DB;
  const img = await decodeImage((await readBody(c)).image);
  if ("error" in img) return fail(c, 400, "invalid_image", "Take a JPEG, PNG or WebP photo under 1.5 MB.");
  if (await hashUsed(db, img.hash)) return fail(c, 409, "duplicate_photo", "This photo has already been logged.");
  const r = await aiJson(c.env, { instructions: MEAL_PROMPT, text: "What is this meal?", image: { mime: img.mime, base64: img.base64 } }, validateMeal, mockMeal, c.env.AI_FETCH);
  const [factors, s] = await Promise.all([factorTable(db), loadSettings(db)]);
  const a = assess(r.value.parts, factors);
  return c.json({
    dish: r.value.dish, parts: r.value.parts, confidence: r.value.confidence, ...a,
    points: a.low_carbon ? s.points_photo_low_carbon : 0, image_hash: img.hash, source: r.source,
  });
});

ai.post("/meals/photo/confirm", student, async (c) => {
  const db = c.env.DB;
  const body = await readBody(c);
  const dish = typeof body.dish === "string" ? body.dish.trim() : "";
  const hash = typeof body.image_hash === "string" && /^[0-9a-f]{64}$/.test(body.image_hash) ? body.image_hash : null;
  const partsOk = body.parts && typeof body.parts === "object" && !Array.isArray(body.parts);
  if (dish.length < 1 || dish.length > 80 || !hash || !partsOk) return fail(c, 400, "invalid_meal", "Check the dish name and try again.");
  if (await hashUsed(db, hash)) return fail(c, 409, "duplicate_photo", "This photo has already been logged.");
  const parts = cleanParts(body.parts);
  const [factors, s] = await Promise.all([factorTable(db), loadSettings(db)]);
  const a = assess(parts, factors);
  const full = a.low_carbon ? s.points_photo_low_carbon : 0;
  let points: number;
  try {
    points = await insertCapped(
      db,
      { user_id: c.get("user")!.id, category: "food", type: "meal", kg_co2e: a.kg_co2e, source: "photo", low_carbon: a.low_carbon, image_hash: hash, detail: { dish, parts } },
      full, s.self_reported_daily_cap, Date.now(),
    );
  } catch (e) {
    if (String(e).includes("UNIQUE")) return fail(c, 409, "duplicate_photo", "This photo has already been logged.");
    throw e;
  }
  return c.json({ points, capped: points < full, ...a }, 201);
});
```

Keep all imports at the top of the file (merge them with Task 4's).

- [ ] **Step 4: Run all tests**

Run: `npx vitest run && npm run typecheck`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/worker test/ai-routes.test.ts
git commit -m "feat(ai): meal photo estimate and unverified +5 entry"
```

---

### Task 6: Admin menu import and draft review

**Files:**
- Create: `src/worker/routes/admin-menu.ts`, `test/admin-menu.test.ts`
- Modify: `src/worker/app.ts`

**Interfaces:**
- Consumes: `aiJson`, `MENU_PROMPT`, `validateMenu`, `mockMenu`, `cleanParts`, `decodeImage`, `computeKg`, `isLowCarbonMeal`
- Produces (admin role only):
  - `GET /api/admin/stalls` → `{ stalls: { id, name, canteen }[] }`
  - `GET /api/admin/items?stall_id=` → `{ items: { id, name, kind, parts, kg_co2e, low_carbon: boolean, status }[] }`
  - `POST /api/admin/menu/photo { stall_id, image }` → 201 `{ items: Draft[], source }` (inserted as `status='draft'`)
  - `POST /api/admin/items/:id { name?, kind?, parts?, status? }` → `{ item }` (recomputes kg and low-carbon when parts change)
  - `POST /api/admin/items/:id/delete` → `{ deleted: true }` for drafts only
  - errors:
    - `404 no_stall`
    - `404 no_item`
    - `400 invalid_image`
    - `400 invalid_item`
    - `409 not_draft`

- [ ] **Step 1: Write the failing test** `test/admin-menu.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { setup } from "./helpers/setup";

const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
const photo = { mime: "image/png", base64: PNG_1PX };

describe("admin menu import", () => {
  it("is admin-only (a switched persona is not an admin)", async () => {
    const ctx = await setup();
    for (const as of ["u-alex", "u-seller-econ"]) expect((await ctx.req("/api/admin/stalls", { as })).status).toBe(403);
    expect((await ctx.req("/api/admin/stalls", { as: "u-admin" })).body.stalls).toHaveLength(3);
  });

  it("turns a menu photo into draft items with kg from factors", async () => {
    const ctx = await setup();
    const res = await ctx.req("/api/admin/menu/photo", { as: "u-admin", body: { stall_id: "econ-rice", image: photo } });
    expect(res.status).toBe(201);
    expect(res.body.source).toBe("mock");
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0]).toMatchObject({ name: "Vegetable fried rice with egg", kind: "meal", status: "draft", low_carbon: true, kg_co2e: 0.63 });
    expect(res.body.items[1]).toMatchObject({ name: "Chicken cutlet rice", low_carbon: false });
    const live = (await ctx.req("/api/stall", { as: "u-seller-econ" })).body.items.map((i: any) => i.name);
    expect(live).not.toContain("Vegetable fried rice with egg");
  });

  it("approving a draft puts it on the seller's menu; editing parts recomputes kg", async () => {
    const ctx = await setup();
    const drafts = (await ctx.req("/api/admin/menu/photo", { as: "u-admin", body: { stall_id: "econ-rice", image: photo } })).body.items;
    const id = drafts[1].id;
    const edited = await ctx.req(`/api/admin/items/${id}`, { as: "u-admin", body: { name: "Tofu cutlet rice", parts: { rice: 80, tofu: 100, veg: 30 } } });
    expect(edited.body.item).toMatchObject({ name: "Tofu cutlet rice", low_carbon: true, kg_co2e: 0.68, status: "draft" });
    await ctx.req(`/api/admin/items/${id}`, { as: "u-admin", body: { status: "live" } });
    const live = (await ctx.req("/api/stall", { as: "u-seller-econ" })).body.items.map((i: any) => i.name);
    expect(live).toContain("Tofu cutlet rice");
  });

  it("deletes drafts but refuses to delete live items", async () => {
    const ctx = await setup();
    const drafts = (await ctx.req("/api/admin/menu/photo", { as: "u-admin", body: { stall_id: "econ-rice", image: photo } })).body.items;
    expect((await ctx.req(`/api/admin/items/${drafts[0].id}/delete`, { as: "u-admin", body: {} })).body).toEqual({ deleted: true });
    const res = await ctx.req("/api/admin/items/econ-veg-egg/delete", { as: "u-admin", body: {} });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("not_draft");
  });

  it.each([
    [{ stall_id: "nope", image: photo }, 404, "no_stall"],
    [{ stall_id: "econ-rice", image: { mime: "text/plain", base64: "QQ==" } }, 400, "invalid_image"],
  ])("rejects %j", async (body, status, error) => {
    const ctx = await setup();
    const res = await ctx.req("/api/admin/menu/photo", { as: "u-admin", body });
    expect(res.status).toBe(status);
    expect(res.body.error).toBe(error);
  });

  it.each([
    [{ name: "" }],
    [{ kind: "snack" }],
    [{ status: "archived" }],
    [{ parts: [1] }],
  ])("400 invalid_item for %j", async (body) => {
    const ctx = await setup();
    const res = await ctx.req("/api/admin/items/econ-veg-egg", { as: "u-admin", body });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_item");
  });

  it("404s for an unknown item", async () => {
    const ctx = await setup();
    expect((await ctx.req("/api/admin/items/nope", { as: "u-admin", body: { name: "X" } })).status).toBe(404);
  });
});
```

Expected kg:
- Vegetable fried rice with egg: 80 × 4.45 + 100 × 0.43 + 50 × 4.67 = 356 + 43 + 233.5 = 632.5 g → 0.63 kg.
- Tofu cutlet rice: 80 × 4.45 + 100 × 3.16 + 30 × 0.43 = 356 + 316 + 12.9 = 684.9 g → 0.68 kg.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/admin-menu.test.ts`
Expected: FAIL (404s)

- [ ] **Step 3: Implement** `src/worker/routes/admin-menu.ts`

```ts
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { fail, readBody } from "../http";
import { decodeImage } from "../image";
import { aiJson } from "../lib/ai";
import { cleanParts, MENU_PROMPT, mockMenu, validateMenu } from "../lib/ai-tasks";
import { computeKg, isLowCarbonMeal, type FactorTable, type Parts } from "../lib/carbon";
import { requireRole } from "../session";

export const adminMenu = new Hono<AppEnv>();
const admin = requireRole("admin");

type ItemRow = { id: string; stall_id: string; name: string; kind: "meal" | "drink"; parts_json: string; kg_co2e: number | null; low_carbon: number; status: string };
const shape = (r: ItemRow) => ({ id: r.id, stall_id: r.stall_id, name: r.name, kind: r.kind, parts: JSON.parse(r.parts_json || "{}"), kg_co2e: r.kg_co2e, low_carbon: r.low_carbon === 1, status: r.status });

async function factorTable(db: D1Database): Promise<FactorTable> {
  const { results } = await db.prepare("SELECT key, kg_per_unit FROM factors WHERE unit = 'kg'").all<{ key: string; kg_per_unit: number | null }>();
  return Object.fromEntries(results.map((r) => [r.key, r.kg_per_unit]));
}
function assess(kind: "meal" | "drink", parts: Parts, f: FactorTable) {
  const kg = Object.keys(parts).length ? computeKg(parts, f) : null;
  return { kg_co2e: kg, low_carbon: kind === "meal" && kg != null && isLowCarbonMeal(parts) ? 1 : 0 };
}
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "item";

adminMenu.get("/admin/stalls", admin, async (c) => {
  const { results } = await c.env.DB.prepare("SELECT id, name, canteen FROM stalls ORDER BY name").all();
  return c.json({ stalls: results });
});

adminMenu.get("/admin/items", admin, async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM items WHERE stall_id = ? ORDER BY status, kind DESC, name").bind(c.req.query("stall_id") ?? "").all<ItemRow>();
  return c.json({ items: results.map(shape) });
});

adminMenu.post("/admin/menu/photo", admin, async (c) => {
  const db = c.env.DB;
  const body = await readBody(c);
  const stall = typeof body.stall_id === "string" ? await db.prepare("SELECT id FROM stalls WHERE id = ?").bind(body.stall_id).first<{ id: string }>() : null;
  if (!stall) return fail(c, 404, "no_stall", "Pick a stall first.");
  const img = await decodeImage(body.image);
  if ("error" in img) return fail(c, 400, "invalid_image", "Take a JPEG, PNG or WebP photo under 1.5 MB.");
  const r = await aiJson(c.env, { instructions: MENU_PROMPT, text: "List this stall's menu.", image: { mime: img.mime, base64: img.base64 } }, validateMenu, mockMenu, c.env.AI_FETCH);
  const f = await factorTable(db);
  const rows = r.value.items.map((i) => ({ id: `${stall.id}-${slug(i.name)}-${crypto.randomUUID().slice(0, 4)}`, stall_id: stall.id, name: i.name, kind: i.kind, parts_json: JSON.stringify(i.parts), ...assess(i.kind, i.parts, f), status: "draft" }));
  await db.batch(rows.map((x) => db.prepare("INSERT INTO items (id, stall_id, name, kind, parts_json, kg_co2e, low_carbon, points, status) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'draft')").bind(x.id, x.stall_id, x.name, x.kind, x.parts_json, x.kg_co2e, x.low_carbon)));
  return c.json({ items: rows.map((x) => shape(x as ItemRow)), source: r.source }, 201);
});

adminMenu.post("/admin/items/:id", admin, async (c) => {
  const db = c.env.DB;
  const cur = await db.prepare("SELECT * FROM items WHERE id = ?").bind(c.req.param("id")).first<ItemRow>();
  if (!cur) return fail(c, 404, "no_item", "That item doesn't exist.");
  const b = await readBody(c);
  const bad =
    ("name" in b && (typeof b.name !== "string" || b.name.trim().length < 1 || b.name.trim().length > 80)) ||
    ("kind" in b && b.kind !== "meal" && b.kind !== "drink") ||
    ("status" in b && b.status !== "draft" && b.status !== "live") ||
    ("parts" in b && (!b.parts || typeof b.parts !== "object" || Array.isArray(b.parts)));
  if (bad) return fail(c, 400, "invalid_item", "Check the name, kind, ingredients and status.");
  const name = "name" in b ? (b.name as string).trim() : cur.name;
  const kind = ("kind" in b ? b.kind : cur.kind) as "meal" | "drink";
  const parts = "parts" in b ? cleanParts(b.parts) : (JSON.parse(cur.parts_json || "{}") as Parts);
  const status = ("status" in b ? b.status : cur.status) as string;
  const a = "parts" in b || "kind" in b ? assess(kind, parts, await factorTable(db)) : { kg_co2e: cur.kg_co2e, low_carbon: cur.low_carbon };
  await db.prepare("UPDATE items SET name = ?, kind = ?, parts_json = ?, kg_co2e = ?, low_carbon = ?, status = ? WHERE id = ?")
    .bind(name, kind, JSON.stringify(parts), a.kg_co2e, a.low_carbon, status, cur.id).run();
  return c.json({ item: shape({ ...cur, name, kind, parts_json: JSON.stringify(parts), kg_co2e: a.kg_co2e, low_carbon: a.low_carbon, status }) });
});

adminMenu.post("/admin/items/:id/delete", admin, async (c) => {
  const db = c.env.DB;
  const cur = await db.prepare("SELECT status FROM items WHERE id = ?").bind(c.req.param("id")).first<{ status: string }>();
  if (!cur) return fail(c, 404, "no_item", "That item doesn't exist.");
  if (cur.status !== "draft") return fail(c, 409, "not_draft", "Only drafts can be deleted. Set it back to draft first.");
  await db.prepare("DELETE FROM items WHERE id = ? AND status = 'draft'").bind(c.req.param("id")).run();
  return c.json({ deleted: true });
});
```

Modify `src/worker/app.ts`: `import { adminMenu } from "./routes/admin-menu";` and `app.route("/", adminMenu);`.

Note: `requireRole("admin")` checks the **current** user's role. An admin who has switched to a student persona must switch back first, which is intended.

- [ ] **Step 4: Run all tests**

Run: `npx vitest run && npm run typecheck`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/worker test/admin-menu.test.ts
git commit -m "feat(ai): admin menu photo to draft items, edit, approve, delete"
```

---

### Task 7: Weekly nudge

**Files:**
- Create: `src/worker/facts.ts`
- Modify: `src/worker/routes/ai.ts`, `test/ai-routes.test.ts`

**Interfaces:**
- Consumes:
  - `aiJson`, `NUDGE_PROMPT`, `validateNudge`, `mockNudge`, `NudgeFacts`
  - `bestSwap`, `sgWeekStart` (earlier stages)
- Produces:
  - `weekFacts(db, uid, now): Promise<NudgeFacts>`
  - `GET /api/me/nudge` → `{ text, source }`, cached in `summaries` for `(user, week_start)` only when `source === "live"`

- [ ] **Step 1: Write the failing tests** (append to `test/ai-routes.test.ts`)

```ts
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run test/ai-routes.test.ts`
Expected: the new tests FAIL (404)

- [ ] **Step 3: Implement**

`src/worker/facts.ts`:
```ts
import type { NudgeFacts } from "./lib/ai-tasks";
import { bestSwap, type MenuItem } from "./lib/swap";
import { sgWeekStart } from "./lib/time";

/** Computed numbers for the weekly nudge. The model only rephrases these. */
export async function weekFacts(db: D1Database, uid: string, now: number): Promise<NudgeFacts> {
  const weekStart = sgWeekStart(now);
  const [user, week, history, menu] = await Promise.all([
    db.prepare("SELECT display_name FROM users WHERE id = ?").bind(uid).first<{ display_name: string }>(),
    db.prepare(
      `SELECT category, COALESCE(SUM(kg_co2e),0) AS kg,
              SUM(CASE WHEN type = 'meal' THEN 1 ELSE 0 END) AS meals,
              SUM(CASE WHEN type = 'meal' AND low_carbon = 1 THEN 1 ELSE 0 END) AS low
       FROM activities WHERE user_id = ? AND created_at >= ? GROUP BY category`,
    ).bind(uid, weekStart).all<{ category: "food" | "mobility" | "waste"; kg: number; meals: number; low: number }>(),
    db.prepare("SELECT item_id FROM activities WHERE user_id = ? AND type = 'meal' AND item_id IS NOT NULL").bind(uid).all<{ item_id: string }>(),
    db.prepare("SELECT i.id, i.name, i.stall_id, i.kind, i.kg_co2e, i.low_carbon FROM items i JOIN stalls s ON s.id = i.stall_id WHERE i.status = 'live' AND s.active = 1").all<MenuItem>(),
  ]);
  const rows = week.results;
  const biggest = rows.filter((r) => r.kg > 0).sort((a, b) => b.kg - a.kg)[0]?.category ?? null;
  return {
    first_name: (user?.display_name ?? "there").split(" ")[0],
    week_kg: Math.round(rows.reduce((n, r) => n + r.kg, 0) * 100) / 100,
    meals_week: rows.reduce((n, r) => n + (r.meals ?? 0), 0),
    low_carbon_meals_week: rows.reduce((n, r) => n + (r.low ?? 0), 0),
    biggest,
    swap: bestSwap(history.results.map((h) => h.item_id), menu.results),
  };
}
```

Append to `src/worker/routes/ai.ts` (imports at the top: `weekFacts` from `../facts`; `mockNudge, NUDGE_PROMPT, validateNudge` from `../lib/ai-tasks`; `sgWeekStart` from `../lib/time`):
```ts
ai.get("/me/nudge", student, async (c) => {
  const db = c.env.DB;
  const uid = c.get("user")!.id;
  const now = Date.now();
  const weekStart = sgWeekStart(now);
  const cached = await db.prepare("SELECT text FROM summaries WHERE user_id = ? AND week_start = ?").bind(uid, weekStart).first<{ text: string }>();
  if (cached) return c.json({ text: cached.text, source: "live" });
  const facts = await weekFacts(db, uid, now);
  const r = await aiJson(c.env, { instructions: NUDGE_PROMPT, text: JSON.stringify(facts) }, validateNudge, () => mockNudge(facts), c.env.AI_FETCH);
  if (r.source === "live") {
    await db.prepare("INSERT INTO summaries (user_id, week_start, text, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, week_start) DO NOTHING")
      .bind(uid, weekStart, r.value.text, now).run();
  }
  return c.json({ text: r.value.text, source: r.source });
});
```

- [ ] **Step 4: Run all tests**

Run: `npx vitest run && npm run typecheck`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/worker test/ai-routes.test.ts
git commit -m "feat(ai): weekly nudge from computed facts, cached when live"
```

---

### Task 8: Log screen: typed trip and meal photo

**Files:**
- Create: `src/app/image.ts`
- Modify: `src/app/screens/Log.tsx`, `src/app/styles.css`

**Interfaces:**
- Consumes: `/api/trips/parse` (Task 4), `/api/meals/photo` and `/confirm` (Task 5)
- Produces: `resizeToJpeg(file: File, max = 1024): Promise<{ mime: "image/jpeg"; base64: string }>`

There are no unit tests for the UI. It is checked by the build and in the browser (Step 4).

- [ ] **Step 1: Write `src/app/image.ts`**

```ts
/** Downscale a camera photo to at most `max` px on the long side and re-encode as JPEG. */
export async function resizeToJpeg(file: File, max = 1024): Promise<{ mime: "image/jpeg"; base64: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
  return { mime: "image/jpeg", base64: dataUrl.slice(dataUrl.indexOf(",") + 1) };
}
```

- [ ] **Step 2: Add styles** (append to `src/app/styles.css`)

```css
.inline { display: flex; gap: 8px; }
.inline input { flex: 1; }
.inline .btn { width: auto; padding: 14px 18px; }
.estimate { background: var(--card); border-radius: 18px; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
.estimate .tag { font-size: 12px; color: var(--muted); }
.file-btn { position: relative; overflow: hidden; }
.file-btn input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
```

- [ ] **Step 3: Extend `src/app/screens/Log.tsx`**

Add state and imports:
```tsx
import { resizeToJpeg } from "../image";
// inside Log():
const [typed, setTyped] = useState("");
const [estimate, setEstimate] = useState<null | { dish: string; parts: Record<string, number>; kg_co2e: number | null; low_carbon: boolean; points: number; image_hash: string; source: "live" | "mock" }>(null);
```

At the top of the Trip section, before the "From" select, add a typed-trip row:
```tsx
        <div className="inline">
          <input type="text" placeholder="Hive to Hall 11" value={typed} maxLength={200} onChange={(e) => setTyped(e.target.value)} />
          <button
            className="btn btn-secondary"
            disabled={busy || typed.trim() === ""}
            onClick={() =>
              run(async () => {
                const r = await api<{ from_id: string; to_id: string; source: string }>("/trips/parse", { text: typed });
                setFrom(r.from_id);
                setTo(r.to_id);
                setTyped("");
                return r.source === "mock" ? "Places filled in (offline estimate). Check them below." : "Places filled in. Check them below.";
              })
            }
          >
            Find
          </button>
        </div>
```

After the container-returns section, add the meal-photo section:
```tsx
      <hr className="rule" />
      <div className="section">
        <h2 className="title">Meal at another stall</h2>
        <p className="body" style={{ fontSize: 14 }}>For stalls without a code. Photo meals are self-reported and earn +5 if plant or egg based.</p>
        {!estimate ? (
          <label className="btn btn-secondary file-btn" aria-disabled={busy}>
            Take a photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                run(async () => {
                  const img = await resizeToJpeg(file);
                  setEstimate(await api("/meals/photo", { image: img }));
                  return "Check the estimate below.";
                });
              }}
            />
          </label>
        ) : (
          <div className="estimate">
            <span className="tag">{estimate.source === "mock" ? "Offline estimate" : "AI estimate"} · self-reported</span>
            <div className="title" style={{ fontSize: 20 }}>{estimate.dish}</div>
            <div className="muted">
              {estimate.kg_co2e == null ? "kg unknown" : `${estimate.kg_co2e} kg CO₂e`}
              {estimate.low_carbon ? " · low-carbon" : ""} · {estimate.points > 0 ? `+${estimate.points}` : "0 points"}
            </div>
            <div className="inline">
              <button className="btn btn-secondary" disabled={busy} onClick={() => setEstimate(null)}>Cancel</button>
              <button
                className="btn"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const r = await api<{ points: number; capped: boolean }>("/meals/photo/confirm", { dish: estimate.dish, parts: estimate.parts, image_hash: estimate.image_hash });
                    setEstimate(null);
                    return `Meal logged ${pts(r.points, r.capped)}`;
                  })
                }
              >
                Log meal
              </button>
            </div>
          </div>
        )}
      </div>
```

Update the heading copy to `Log a trip, steps, a return or a meal.`

- [ ] **Step 4: Build and check in the browser**

Run: `npm run build && npm run typecheck`
Expected: no errors.

Start the preview (config `dev`; `.dev.vars` has `AI_API_KEY`, and `wrangler.jsonc` vars come in Task 10, so the local run uses the mock until then). At 375 px, as a fresh student on Log:
1. Type "hive to hall 11" and tap Find. Both selects fill in (The Hive, Hall 11), the toast mentions an offline estimate, and the options appear.
2. Type "somewhere nice" and tap Find. The error reads "Couldn't tell both places…".
3. Tap "Take a photo" and pick any image file. The estimate card shows "Vegetarian noodles with tofu · 0.39 kg · low-carbon · +5" with the "Offline estimate" tag. Tap Log meal: the toast reads "Meal logged · +5".
4. Pick the same file again. The error reads "This photo has already been logged."
5. There is no horizontal scroll.

- [ ] **Step 5: Commit**

```bash
git add src/app
git commit -m "feat(app): typed trip and meal photo on Log"
```

---

### Task 9: Nudge on Today and the admin menu import screen

**Files:**
- Create: `src/app/screens/MenuImport.tsx`
- Modify: `src/app/screens/Home.tsx`, `src/app/screens/Admin.tsx`, `src/app/App.tsx`

**Interfaces:**
- Consumes: `/api/me/nudge` (Task 7), the admin menu endpoints (Task 6)

- [ ] **Step 1: Nudge on Today.** In `Home.tsx`, inside the main (not first-visit) view:
  1. Add `const [nudge, setNudge] = useState<string | null>(null);` next to the existing state.
  2. After the summary loads, fetch the nudge: add `useEffect(() => { api<{ text: string }>("/me/nudge").then((n) => setNudge(n.text)).catch(() => {}); }, []);`
  3. Replace the swap paragraph with the nudge when there is one, and keep the swap line as the fallback while it loads:

```tsx
      {nudge ? (
        <p className="body" style={{ fontSize: 14 }}>{nudge}</p>
      ) : data.swap ? (
        <p className="body" style={{ fontSize: 14 }}>
          Swap {shortName(data.swap.from).toLowerCase()} for {shortName(data.swap.to).toLowerCase()} to save {data.swap.saves_kg} kg next time.
        </p>
      ) : null}
```

Put the two hooks at the top of `Home` (hooks can't sit below the early returns).

- [ ] **Step 2: Write `src/app/screens/MenuImport.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api";
import { resizeToJpeg } from "../image";

type Stall = { id: string; name: string; canteen: string };
type Item = { id: string; name: string; kind: "meal" | "drink"; kg_co2e: number | null; low_carbon: boolean; status: "draft" | "live" };

export function MenuImport() {
  const [stalls, setStalls] = useState<Stall[]>([]);
  const [stall, setStall] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    api<{ stalls: Stall[] }>("/admin/stalls").then((d) => setStalls(d.stalls)).catch(() => setError("Admins only. Switch back to the admin account."));
  }, []);
  useEffect(() => {
    if (!stall) return setItems([]);
    api<{ items: Item[] }>(`/admin/items?stall_id=${encodeURIComponent(stall)}`).then((d) => setItems(d.items)).catch(() => setItems([]));
  }, [stall]);

  async function run(fn: () => Promise<string | null>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      setNote(await fn());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const reload = async () => setItems((await api<{ items: Item[] }>(`/admin/items?stall_id=${encodeURIComponent(stall)}`)).items);

  return (
    <>
      <div>
        <div className="eyebrow">Admin</div>
        <h1 className="display" style={{ marginTop: 8 }}>Import a menu from a photo.</h1>
      </div>
      <p className="body" style={{ fontSize: 14 }}>AI suggests dishes and ingredients; kg comes from the factor table. Nothing goes live until you approve it.</p>
      {error && <p className="error">{error}</p>}
      {note && <div className="toast" role="status">{note}</div>}
      <select value={stall} onChange={(e) => setStall(e.target.value)}>
        <option value="">Choose a stall</option>
        {stalls.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.canteen}</option>)}
      </select>
      {stall && (
        <label className="btn btn-secondary file-btn">
          Photo of the menu board
          <input
            type="file"
            accept="image/*"
            capture="environment"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              run(async () => {
                const r = await api<{ items: Item[]; source: string }>("/admin/menu/photo", { stall_id: stall, image: await resizeToJpeg(file) });
                await reload();
                return `${r.items.length} draft${r.items.length === 1 ? "" : "s"} added${r.source === "mock" ? " (offline estimate)" : ""}.`;
              });
            }}
          />
        </label>
      )}
      <div className="list">
        {items.map((i) => (
          <div className="row" key={i.id} style={{ alignItems: "center" }}>
            <div>
              <div className="what">{i.name}</div>
              <div className="meta">
                {i.status} · {i.kind} · {i.kg_co2e == null ? "kg unknown" : `${i.kg_co2e} kg`}{i.low_carbon ? " · low-carbon" : ""}
              </div>
            </div>
            {i.status === "draft" && (
              <div className="inline">
                <button className="link-btn" disabled={busy} onClick={() => run(async () => { await api(`/admin/items/${i.id}/delete`, {}); await reload(); return null; })}>Discard</button>
                <button className="link-btn" disabled={busy} onClick={() => run(async () => { await api(`/admin/items/${i.id}`, { status: "live" }); await reload(); return `${i.name} is live.`; })}>Approve</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
```

- [ ] **Step 3: Link and route**

In `Admin.tsx`, under the header, add (only meaningful for a real admin, and the endpoint enforces it):
```tsx
      <button className="btn btn-secondary" onClick={() => navigate("/admin/menu")}>Import a menu from a photo</button>
```
Also add `import { navigate } from "../router";`.

In `App.tsx`: import `MenuImport`, and add a route before the `/admin` line:
```tsx
      {path === "/admin/menu" && role === "admin" && <MenuImport />}
```
Change the `main` definition to `const main = path !== "/claim" && !path.startsWith("/admin");`, and the admin fallback line to `{main && role === "admin" && <Admin />}` (unchanged). Keep `{path === "/admin" && me.can_switch && <Admin />}`.

- [ ] **Step 4: Build and check in the browser**

Run: `npm run build && npm run typecheck && npx vitest run`
Expected: no errors, all PASS.

At 375 px:
1. As a student with this week's activity, Today shows the nudge sentence where the swap line was.
2. Switch to the admin account (the real `u-admin`, or a Simon admin) → Switch persona → "Import a menu from a photo". Choose Economy Rice, pick any image, and 2 drafts appear with "(offline estimate)".
3. Approve one. Switch to the Economy Rice seller: the approved dish is in the grid.
4. Discard the other: it disappears.

- [ ] **Step 5: Commit**

```bash
git add src/app
git commit -m "feat(app): weekly nudge on Today and admin menu import"
```

---

### Task 10: Turn on Gemini, check it live, deploy

This deploys the approved app and makes real Gemini calls with the user's key, which is already stored as a secret and in `.dev.vars`. Never print the key.

**Files:**
- Modify: `wrangler.jsonc`, `docs/superpowers/specs/2026-09-29-campus-carbon-app-design.md` (§9.1)

- [ ] **Step 1: Add the AI vars** to `wrangler.jsonc` (top level, next to `observability`):

```jsonc
  "vars": {
    "AI_MODE": "live",
    "AI_BASE_URL": "https://generativelanguage.googleapis.com/v1beta/openai/",
    "AI_MODEL": "gemini-flash-lite-latest",
    "AI_FALLBACK_MODEL": "gemini-3.8-flash"
  },
```

Run: `npm run cf-typegen && npm run typecheck`
Expected: types regenerate with no errors.

- [ ] **Step 2: Check live AI locally.** Start the dev server. As a fresh student:
  1. Log → type "from north spine to the sports centre" → Find. The selects fill in, with no "offline" in the toast.
  2. Take a meal photo of a real dish (any food photo on disk). The estimate card says "AI estimate", and the dish looks plausible.
  3. Today shows a nudge. `GET /api/me/nudge` returns `source: "live"`.

  If Gemini answers 503 for both models, it's the free tier's load. Note it, retry once a few minutes later, and if it's still 503, record it and continue. The app falls back to the mock by design.

- [ ] **Step 3: Update spec §9.1.** Under "Configuration", add:

```markdown
Configured provider (2026-09-30): Google Gemini via `https://generativelanguage.googleapis.com/v1beta/openai/`. Primary `gemini-flash-lite-latest` (fast, and it answered when the larger Flash models were returning 503 "high demand" on the free tier). Fallback `gemini-3.8-flash`. The 8 s timeout applies per attempt, so the worst case is two attempts, then the mock.
```

- [ ] **Step 4: Deploy and smoke-test**

Run: `npm run deploy`, then `curl -s https://campus-carbon.stan322.workers.dev/api/health`
Expected: `{"ok":true}`. Then, on the live site as a fresh student, repeat Step 2 item 1 (typed trip).

- [ ] **Step 5: Commit**

```bash
git add wrangler.jsonc worker-configuration.d.ts docs/superpowers/specs/2026-09-29-campus-carbon-app-design.md
git commit -m "chore: enable Gemini for AI features"
```
