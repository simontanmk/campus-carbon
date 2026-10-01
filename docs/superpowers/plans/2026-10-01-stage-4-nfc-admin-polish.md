# Stage 4: NFC, Admin, Export and Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the prototype for the demo:
- the NFC tap-and-confirm flow (spec §8.2)
- the admin hub (spec §11): stalls and items editing, point and cap settings including mission rewards, NFC sticker links, and the CSV export for the pilot evaluation
- the edit steps deferred from Stage 3 (student dish name, admin drafts)
- the deferred hardening and polish items from earlier reviews

**Architecture:**
- **Shared claim core:** the QR claim's checks and its atomic award move into `src/worker/claims.ts`, so QR and NFC share one path.
- **NFC:** a seller-created `method='nfc'` token. A student's `/tap` attaches them as `pending_user_id`, and the seller's Confirm awards the points.
- **Mission rewards become settings** (`mission_points_<id>`) with the code values as defaults. The missions module takes an optional points map.
- **Admin screens** are thin forms over the endpoints.

**Tech Stack:** as before, plus Hono's built-in `hono/body-limit`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-29-campus-carbon-app-design.md` (§7, §8.2, §9.2, §11, §12, §16)

**Follows:** Stage 3 (merged). This is the last planned stage.

## Global Constraints

- **NFC** (spec §8.2):
  - The sticker URL is `https://<app>/tap?stall=<stall_id>`. It uses the phone's built-in tag reader, never Web NFC.
  - Seller taps an item → an NFC token (90 s), which expires any other pending NFC token at that stall.
  - `/tap` attaches the student only if a pending, unexpired token with no `pending_user_id` exists.
  - **Nothing is recorded until the seller taps Confirm.** `confirmed_at` is recorded, so confirm latency can be measured.
  - NFC activities are `verified = 1`, `source = 'nfc'`, with the same points, rate limits and atomic single award as QR.
- **`verify_method`:** `qr` allows only QR tokens, `nfc` only NFC, `both` either. Default `qr`.
- **Settings:** every point value, cap and limit in `settings` is editable by an admin, including mission rewards (`mission_points_<mission id>`). Values are integers 0–100,000. Missing keys fall back to code defaults.
- **CSV export** (spec "Evaluation hooks"): one row per activity with the `verified` and `source` columns, admin-only. Users are identified by their opaque id, not their display name.
- **Admin tools** need the real admin role. A switched persona sees only the persona list.
- **Errors:** every error is `{ error, message }`. No 500s for bad input. Oversized photo uploads get 413.
- **Stage 1–3 constraints** still hold. In particular, AI never sets kg or the low-carbon flag, and photo meals stay unverified.

## Review Focus

1. **A copied sticker URL opened off-site while a token is pending.** It can attach to the token, but nothing is recorded without the seller's Confirm, and the seller sees the name before confirming. Pinned in Task 2.
2. **Two students tap the same pending token.** The second gets `no_pending`. Two Confirm taps award once. Pinned in Task 2.
3. **A QR-only stall's sticker, an NFC token claimed through `/claim`, or confirming another stall's token.** Each is rejected with a clear error. Pinned in Task 2.
4. **An admin sets a mission reward to 0 or changes a cap.** Today, Missions and Ranks all use the new value at once and agree. Pinned in Tasks 4 and 11.
5. **CSV values containing commas, quotes or newlines** (dish names, display names). Correctly quoted. Pinned in Task 5.
6. **Deleting an item that activities or tokens refer to.** Returns `409 in_use`, never a 500. Pinned in Task 6.

---

## File Structure

```
src/worker/claims.ts                 TokenRow, loadToken, claimBlocker, award (shared QR/NFC core)
src/worker/routes/claim.ts           (modify) use claims.ts
src/worker/routes/stall.ts           (modify) method qr|nfc on token create; "tapped" status; confirm
src/worker/routes/nfc.ts             POST /tap, GET /tap/:id, POST /stall/tokens/:id/confirm
src/worker/lib/missions.ts           (modify) optional mission points map
src/worker/lib/leaderboard.ts        (modify) pass points map
src/worker/acts.ts                   (modify) standings(points); safe JSON
src/worker/db.ts                     (modify) loadMissionPoints
src/worker/routes/progress.ts, me.ts (modify) use configured mission points
src/worker/routes/admin-settings.ts  GET/POST /admin/settings
src/worker/lib/csv.ts                toCsv
src/worker/routes/admin-export.ts    GET /admin/export.csv
src/worker/routes/admin-menu.ts      (modify) stall update, item create, delete in-use guard, longer ids
src/worker/routes/ai.ts              (modify) body limit
src/worker/image.ts                  (modify) faster decode
src/worker/lib/ai-tasks.ts           (modify) nudge prompt 2–3 sentences incl. swap
src/app/copy.ts                      (modify) parsePartsText, formatParts
src/app/screens/Stall.tsx            (modify) QR/NFC mode, NFC sheet with Confirm
src/app/screens/Tap.tsx              student tap-and-wait screen
src/app/screens/Admin.tsx            (modify) hub for real admins
src/app/screens/AdminStalls.tsx      stalls and items editor, NFC sticker URL
src/app/screens/AdminSettings.tsx    points, caps, limits, mission rewards
src/app/components/MealPhoto.tsx     (modify) editable dish name
src/app/screens/Ranks.tsx, Missions.tsx (modify) copy, progressbar role
src/app/App.tsx                      (modify) routes /tap, /admin/stalls, /admin/settings
docs/demo-checklist.md               (modify) NFC, AI, export checks
```

---

### Task 1: Extract the shared claim core

**Files:**
- Create: `src/worker/claims.ts`
- Modify: `src/worker/routes/claim.ts`

**Interfaces:**
- Produces:
  - `type TokenRow` (the claim query's row, plus `created_at`, `pending_user_id` and `used_by`)
  - `loadToken(db, id): Promise<TokenRow | null>`
  - `type Blocker = readonly [ContentfulStatusCode, string, string]`
  - `claimBlocker(db, tok, userId, now, s): Promise<Blocker | null>`: used, expired, inactive stall, per-stall window, daily max, in that order
  - `type ClaimResult = { item_name, stall_name, kind, low_carbon, kg_co2e, points, activities: { type, points, kg_co2e }[] }`
  - `award(db, tok, userId, now, s, source: "qr" | "nfc"): Promise<ClaimResult | null>`: atomic single winner; sets `confirmed_at` for NFC; releases the token if the insert fails; returns null if someone else won

- [ ] **Step 1: Implement `src/worker/claims.ts`.** This is a refactor: the code moves out of `claim.ts` unchanged except for the `source` parameter and `confirmed_at`.

```ts
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { insertActivity } from "./activities";
import { byoPoints, stallClaimPoints } from "./lib/scoring";
import type { Settings } from "./lib/settings";
import { sgDayStart } from "./lib/time";

export type TokenRow = {
  id: string; stall_id: string; item_id: string; byo: number; method: string;
  created_at: number; expires_at: number; used_at: number | null; used_by: string | null; pending_user_id: string | null;
  item_name: string; kind: "meal" | "drink"; kg_co2e: number | null; low_carbon: number; item_points: number | null;
  stall_name: string; active: number;
};
export type Blocker = readonly [ContentfulStatusCode, string, string];
export type ClaimResult = {
  item_name: string; stall_name: string; kind: "meal" | "drink"; low_carbon: boolean; kg_co2e: number | null; points: number;
  activities: { type: string; points: number; kg_co2e: number | null }[];
};

export function loadToken(db: D1Database, id: string): Promise<TokenRow | null> {
  return db
    .prepare(
      `SELECT t.id, t.stall_id, t.item_id, t.byo, t.method, t.created_at, t.expires_at, t.used_at, t.used_by, t.pending_user_id,
              i.name AS item_name, i.kind, i.kg_co2e, i.low_carbon, i.points AS item_points,
              s.name AS stall_name, s.active
       FROM tokens t JOIN items i ON i.id = t.item_id JOIN stalls s ON s.id = t.stall_id
       WHERE t.id = ?`,
    )
    .bind(id)
    .first<TokenRow>();
}

/** Why this student can't claim this token now, or null. Same order and wording as the Stage 1 QR claim. */
export async function claimBlocker(db: D1Database, tok: TokenRow, userId: string, now: number, s: Settings): Promise<Blocker | null> {
  if (tok.used_at != null) return [409, "used", "This code has already been used."];
  if (now > tok.expires_at) return [410, "expired", "This code has expired. Ask the stall for a new one."];
  if (tok.active !== 1) return [403, "stall_inactive", "This stall isn't taking claims right now."];
  const recent = await db
    .prepare("SELECT COUNT(*) AS n FROM activities WHERE user_id = ? AND stall_id = ? AND type IN ('meal','drink') AND verified = 1 AND created_at > ?")
    .bind(userId, tok.stall_id, now - s.rate_stall_window_min * 60_000)
    .first<number>("n");
  if ((recent ?? 0) > 0) return [429, "rate_limited", `You can claim at this stall once every ${s.rate_stall_window_min} minutes.`];
  const today = await db
    .prepare("SELECT COUNT(*) AS n FROM activities WHERE user_id = ? AND type IN ('meal','drink') AND verified = 1 AND created_at >= ?")
    .bind(userId, sgDayStart(now))
    .first<number>("n");
  if ((today ?? 0) >= s.rate_daily_max) return [429, "daily_limit", `You've reached today's limit of ${s.rate_daily_max} claims.`];
  return null;
}

/** Marks the token used (exactly one winner) and records the verified activities. Null if someone else won. */
export async function award(db: D1Database, tok: TokenRow, userId: string, now: number, s: Settings, source: "qr" | "nfc"): Promise<ClaimResult | null> {
  const upd = await db
    .prepare("UPDATE tokens SET used_at = ?1, used_by = ?2, confirmed_at = CASE WHEN method = 'nfc' THEN ?1 ELSE confirmed_at END WHERE id = ?3 AND used_at IS NULL")
    .bind(now, userId, tok.id)
    .run();
  if (upd.meta.changes !== 1) return null;

  const low = tok.kind === "meal" && tok.low_carbon === 1;
  const mainPoints = stallClaimPoints({ kind: tok.kind, low_carbon: low, points: tok.item_points }, s);
  const base = { user_id: userId, verified: true, source, token_id: tok.id, stall_id: tok.stall_id, created_at: now };
  const stmts = [insertActivity(db, { ...base, category: "food", type: tok.kind, kg_co2e: tok.kg_co2e, points: mainPoints, item_id: tok.item_id, low_carbon: tok.kind === "meal" ? low : null })];
  const activities = [{ type: tok.kind as string, points: mainPoints, kg_co2e: tok.kg_co2e }];
  if (tok.byo === 1) {
    const p = byoPoints(s);
    stmts.push(insertActivity(db, { ...base, category: "waste", type: "byo", kg_co2e: null, points: p }));
    activities.push({ type: "byo", points: p, kg_co2e: null });
  }
  try {
    await db.batch(stmts);
  } catch (err) {
    // Release the token so the student can try again instead of hitting "already used".
    await db.prepare("UPDATE tokens SET used_at = NULL, used_by = NULL, confirmed_at = NULL WHERE id = ? AND used_by = ?").bind(tok.id, userId).run();
    throw err;
  }
  return {
    item_name: tok.item_name, stall_name: tok.stall_name, kind: tok.kind, low_carbon: low, kg_co2e: tok.kg_co2e,
    points: activities.reduce((n, a) => n + a.points, 0), activities,
  };
}
```

- [ ] **Step 2: Shrink the handler.** Replace the body of the `claim.post("/claim", …)` handler in `src/worker/routes/claim.ts` from the token query onwards, and remove the now-unused local `TokenRow` type and imports:

```ts
  const tok = await loadToken(db, id);
  if (!tok || tok.method !== "qr") return fail(c, 400, "invalid_token", INVALID);
  const now = Date.now();
  const s = await loadSettings(db);
  const block = await claimBlocker(db, tok, user.id, now, s);
  if (block) return fail(c, ...block);
  const result = await award(db, tok, user.id, now, s, "qr");
  if (!result) return fail(c, 409, "used", "This code has already been used.");
  return c.json(result);
```
with `import { award, claimBlocker, loadToken } from "../claims";`.

- [ ] **Step 3: Run all tests.** This is a pure refactor, and Stage 1's claim tests are the check.

Run: `npx vitest run && npm run typecheck`
Expected: all PASS, including concurrent claims, rate limits and the insert-failure release, with no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/worker/claims.ts src/worker/routes/claim.ts
git commit -m "refactor: shared claim core for QR and NFC"
```

---

### Task 2: NFC API

**Files:**
- Create: `src/worker/routes/nfc.ts`, `test/nfc.test.ts`
- Modify: `src/worker/routes/stall.ts`, `src/worker/app.ts`

**Interfaces:**
- Consumes: `loadToken`, `claimBlocker`, `award` (Task 1)
- Produces:
  - `POST /api/stall/tokens { item_id, byo, method?: "qr" | "nfc" }`. The default is `qr`. Returns `400 method_off` when the stall's `verify_method` doesn't allow the method. An NFC token expires any other pending NFC token at the stall.
  - `GET /api/stall/tokens/:id` → `{ state: "pending" | "tapped" | "claimed" | "expired", expires_at, claimed_by, pending_name }`
  - `POST /api/tap { stall_id }` (student) → 201 `{ token_id, stall_name, item_name }`
  - `GET /api/tap/:id` (the tapping student) → `{ state: "waiting" | "confirmed" | "expired", stall_name, item_name, result? }`
  - `POST /api/stall/tokens/:id/confirm` (seller) → `{ claimed_by, points }`
  - errors:
    - `404 no_stall`
    - `403 nfc_off`
    - `404 no_pending`
    - `409 taken`
    - `404 no_token`
    - `400 not_nfc`
    - `409 not_tapped`
    - `409 used`
    - plus the shared claim blockers

- [ ] **Step 1: Write the failing test** `test/nfc.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { setup as baseSetup } from "./helpers/setup";

async function setup() {
  const ctx = await baseSetup();
  ctx.raw.exec("DELETE FROM activities WHERE id LIKE 'seed-%'"); // keep rate limits independent of persona history
  return ctx;
}
async function student(ctx: Awaited<ReturnType<typeof setup>>, name = "Tapper") {
  return (await ctx.req("/api/session", { body: { display_name: name } })).body.user.id as string;
}
const nfcToken = (ctx: any, item_id = "veg-noodles", byo = false) =>
  ctx.req("/api/stall/tokens", { as: "u-seller-noodles", body: { item_id, byo, method: "nfc" } });

describe("NFC token creation", () => {
  it("is refused at a QR-only stall", async () => {
    const ctx = await setup();
    const res = await ctx.req("/api/stall/tokens", { as: "u-seller-econ", body: { item_id: "econ-veg-egg", method: "nfc" } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("method_off");
  });

  it("a new NFC token expires the stall's previous pending one", async () => {
    const ctx = await setup();
    const first = (await nfcToken(ctx)).body;
    await nfcToken(ctx, "wanton-mee");
    expect((await ctx.req(`/api/stall/tokens/${first.id}`, { as: "u-seller-noodles" })).body.state).toBe("expired");
  });

  it("QR stays the default and is refused at an NFC-only stall", async () => {
    const ctx = await setup();
    ctx.raw.exec("UPDATE stalls SET verify_method='nfc' WHERE id='noodles'");
    const res = await ctx.req("/api/stall/tokens", { as: "u-seller-noodles", body: { item_id: "veg-noodles" } });
    expect(res.body.error).toBe("method_off");
  });
});

describe("tap → seller confirm", () => {
  it("records nothing until the seller confirms, then awards like QR with source nfc", async () => {
    const ctx = await setup();
    const uid = await student(ctx);
    const t = (await nfcToken(ctx, "veg-noodles", true)).body;
    const tap = await ctx.req("/api/tap", { as: uid, body: { stall_id: "noodles" } });
    expect(tap.status).toBe(201);
    expect(tap.body).toEqual({ token_id: t.id, stall_name: "Noodles & Rice Plates", item_name: "Vegetarian noodles with tofu" });
    expect((ctx.raw.prepare("SELECT COUNT(*) AS n FROM activities WHERE user_id=?").get(uid) as any).n).toBe(0);
    expect((await ctx.req(`/api/tap/${t.id}`, { as: uid })).body.state).toBe("waiting");

    const status = (await ctx.req(`/api/stall/tokens/${t.id}`, { as: "u-seller-noodles" })).body;
    expect(status).toMatchObject({ state: "tapped", pending_name: "Tapper" });

    const conf = await ctx.req(`/api/stall/tokens/${t.id}/confirm`, { as: "u-seller-noodles", body: {} });
    expect(conf.status).toBe(200);
    expect(conf.body).toEqual({ claimed_by: "Tapper", points: 35 });
    const rows = ctx.raw.prepare("SELECT type, verified, source FROM activities WHERE user_id=? ORDER BY type DESC").all(uid);
    expect(rows).toEqual([{ type: "meal", verified: 1, source: "nfc" }, { type: "byo", verified: 1, source: "nfc" }]);
    expect((ctx.raw.prepare("SELECT confirmed_at FROM tokens WHERE id=?").get(t.id) as any).confirmed_at).not.toBeNull();

    const done = (await ctx.req(`/api/tap/${t.id}`, { as: uid })).body;
    expect(done).toMatchObject({ state: "confirmed", result: { points: 35, low_carbon: true, item_name: "Vegetarian noodles with tofu" } });
  });

  it("a second student finds nothing pending once someone has tapped", async () => {
    const ctx = await setup();
    const a = await student(ctx, "First");
    const b = await student(ctx, "Second");
    await nfcToken(ctx);
    expect((await ctx.req("/api/tap", { as: a, body: { stall_id: "noodles" } })).status).toBe(201);
    const second = await ctx.req("/api/tap", { as: b, body: { stall_id: "noodles" } });
    expect(second.status).toBe(404);
    expect(second.body.error).toBe("no_pending");
  });

  it("confirming twice awards once", async () => {
    const ctx = await setup();
    const uid = await student(ctx);
    const t = (await nfcToken(ctx)).body;
    await ctx.req("/api/tap", { as: uid, body: { stall_id: "noodles" } });
    const results = await Promise.all([
      ctx.req(`/api/stall/tokens/${t.id}/confirm`, { as: "u-seller-noodles", body: {} }),
      ctx.req(`/api/stall/tokens/${t.id}/confirm`, { as: "u-seller-noodles", body: {} }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((ctx.raw.prepare("SELECT COUNT(*) AS n FROM activities WHERE token_id=?").get(t.id) as any).n).toBe(1);
  });

  it.each([
    ["nothing pending", async (ctx: any) => {}, "noodles", 404, "no_pending"],
    ["QR-only stall", async (ctx: any) => {}, "econ-rice", 403, "nfc_off"],
    ["unknown stall", async (ctx: any) => {}, "nope", 404, "no_stall"],
    ["expired token", async (ctx: any) => { const t = (await nfcToken(ctx)).body; ctx.raw.exec(`UPDATE tokens SET expires_at=0 WHERE id='${t.id}'`); }, "noodles", 404, "no_pending"],
  ])("tap with %s → %i %s", async (_n, prep, stall_id, status, error) => {
    const ctx = await setup();
    const uid = await student(ctx);
    await prep(ctx);
    const res = await ctx.req("/api/tap", { as: uid, body: { stall_id } });
    expect(res.status).toBe(status);
    expect(res.body.error).toBe(error);
  });

  it("applies the per-stall rate limit at tap time", async () => {
    const ctx = await setup();
    const uid = await student(ctx);
    ctx.raw.exec(`INSERT INTO activities (id,user_id,category,type,points,verified,source,stall_id,created_at) VALUES ('r','${uid}','food','meal',0,1,'qr','noodles',${Date.now() - 60_000})`);
    await nfcToken(ctx);
    const res = await ctx.req("/api/tap", { as: uid, body: { stall_id: "noodles" } });
    expect(res.status).toBe(429);
    expect(res.body.error).toBe("rate_limited");
  });

  it("sellers can't tap; confirm before a tap, of another stall's token, or of a QR token is refused", async () => {
    const ctx = await setup();
    expect((await ctx.req("/api/tap", { as: "u-seller-noodles", body: { stall_id: "noodles" } })).status).toBe(403);
    const t = (await nfcToken(ctx)).body;
    expect((await ctx.req(`/api/stall/tokens/${t.id}/confirm`, { as: "u-seller-noodles", body: {} })).body.error).toBe("not_tapped");
    expect((await ctx.req(`/api/stall/tokens/${t.id}/confirm`, { as: "u-seller-econ", body: {} })).status).toBe(404);
    const qr = (await ctx.req("/api/stall/tokens", { as: "u-seller-noodles", body: { item_id: "veg-noodles" } })).body;
    expect((await ctx.req(`/api/stall/tokens/${qr.id}/confirm`, { as: "u-seller-noodles", body: {} })).body.error).toBe("not_nfc");
  });

  it("an NFC token can't be claimed through the QR route", async () => {
    const ctx = await setup();
    const uid = await student(ctx);
    const t = (await nfcToken(ctx)).body;
    const res = await ctx.req("/api/claim", { as: uid, body: { t: t.token } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_token");
  });

  it("only the tapping student can read the tap status", async () => {
    const ctx = await setup();
    const a = await student(ctx, "A");
    const b = await student(ctx, "B");
    const t = (await nfcToken(ctx)).body;
    await ctx.req("/api/tap", { as: a, body: { stall_id: "noodles" } });
    expect((await ctx.req(`/api/tap/${t.id}`, { as: b })).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/nfc.test.ts`
Expected: FAIL (`method_off` is not returned yet, and the routes 404)

- [ ] **Step 3: Implement**

In `src/worker/routes/stall.ts`, `POST /stall/tokens`:
- Change the item query to also select the stall's `verify_method`: `SELECT i.id, i.stall_id, i.status, s.active, s.verify_method FROM items i JOIN stalls s ON s.id = i.stall_id WHERE i.id = ?`, and add `verify_method: string` to its row type.
- After the existing checks, add:

```ts
  const method = body.method === "nfc" ? "nfc" : "qr";
  if (item.verify_method !== "both" && item.verify_method !== method) {
    return fail(c, 400, "method_off", method === "nfc" ? "This stall uses QR codes." : "This stall uses its NFC sticker.");
  }
```
- Before the insert, for NFC, expire other pending NFC tokens:

```ts
  if (method === "nfc") {
    await db.prepare("UPDATE tokens SET expires_at = ? WHERE stall_id = ? AND method = 'nfc' AND used_at IS NULL AND expires_at > ?").bind(now, item.stall_id, now).run();
  }
```
- Change the insert's literal `'qr'` to a bound `method` (`… VALUES (?, ?, ?, ?, ?, ?, ?)` with `method` in fifth position), and add `method` to the JSON response.

Replace `GET /stall/tokens/:id` with:
```ts
stall.get("/stall/tokens/:id", seller, async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT t.stall_id, t.expires_at, t.used_at, t.pending_user_id, u.display_name AS claimed_by, p.display_name AS pending_name
     FROM tokens t LEFT JOIN users u ON u.id = t.used_by LEFT JOIN users p ON p.id = t.pending_user_id WHERE t.id = ?`,
  )
    .bind(c.req.param("id"))
    .first<{ stall_id: string; expires_at: number; used_at: number | null; pending_user_id: string | null; claimed_by: string | null; pending_name: string | null }>();
  if (!row || row.stall_id !== c.get("user")!.stall_id) return fail(c, 404, "no_token", "Code not found.");
  const state = row.used_at != null ? "claimed" : Date.now() > row.expires_at ? "expired" : row.pending_user_id ? "tapped" : "pending";
  return c.json({ state, expires_at: row.expires_at, claimed_by: row.claimed_by ?? null, pending_name: row.pending_name ?? null });
});
```

Create `src/worker/routes/nfc.ts`:
```ts
import { Hono } from "hono";
import { award, claimBlocker, loadToken } from "../claims";
import { loadSettings } from "../db";
import type { AppEnv } from "../env";
import { fail, readBody } from "../http";
import { requireRole } from "../session";

export const nfc = new Hono<AppEnv>();
const student = requireRole("student");
const seller = requireRole("seller");

nfc.post("/tap", student, async (c) => {
  const db = c.env.DB;
  const uid = c.get("user")!.id;
  const b = await readBody(c);
  const now = Date.now();
  const stall = typeof b.stall_id === "string"
    ? await db.prepare("SELECT id, verify_method FROM stalls WHERE id = ?").bind(b.stall_id).first<{ id: string; verify_method: string }>()
    : null;
  if (!stall) return fail(c, 404, "no_stall", "This sticker isn't linked to a stall.");
  if (stall.verify_method === "qr") return fail(c, 403, "nfc_off", "This stall uses QR codes. Scan the code on the seller's screen.");
  const pending = await db
    .prepare("SELECT id FROM tokens WHERE stall_id = ? AND method = 'nfc' AND used_at IS NULL AND pending_user_id IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1")
    .bind(stall.id, now)
    .first<{ id: string }>();
  if (!pending) return fail(c, 404, "no_pending", "Ask the seller to tap what you bought first, then tap the sticker again.");
  const tok = (await loadToken(db, pending.id))!;
  const block = await claimBlocker(db, tok, uid, now, await loadSettings(db));
  if (block) return fail(c, ...block);
  const upd = await db.prepare("UPDATE tokens SET pending_user_id = ? WHERE id = ? AND pending_user_id IS NULL AND used_at IS NULL").bind(uid, tok.id).run();
  if (upd.meta.changes !== 1) return fail(c, 409, "taken", "Someone else tapped first. Ask the seller to tap the item again.");
  return c.json({ token_id: tok.id, stall_name: tok.stall_name, item_name: tok.item_name }, 201);
});

nfc.get("/tap/:id", student, async (c) => {
  const db = c.env.DB;
  const uid = c.get("user")!.id;
  const tok = await loadToken(db, c.req.param("id"));
  if (!tok || tok.pending_user_id !== uid) return fail(c, 404, "no_token", "Tap not found.");
  const base = { stall_name: tok.stall_name, item_name: tok.item_name };
  if (tok.used_at != null && tok.used_by === uid) {
    const { results } = await db.prepare("SELECT type, points, kg_co2e FROM activities WHERE token_id = ? AND user_id = ?").bind(tok.id, uid).all<{ type: string; points: number; kg_co2e: number | null }>();
    const low = tok.kind === "meal" && tok.low_carbon === 1;
    return c.json({ state: "confirmed", ...base, result: { item_name: tok.item_name, stall_name: tok.stall_name, kind: tok.kind, low_carbon: low, kg_co2e: tok.kg_co2e, points: results.reduce((n, r) => n + r.points, 0), activities: results } });
  }
  if (tok.used_at != null || Date.now() > tok.expires_at) return c.json({ state: "expired", ...base });
  return c.json({ state: "waiting", ...base });
});

nfc.post("/stall/tokens/:id/confirm", seller, async (c) => {
  const db = c.env.DB;
  const tok = await loadToken(db, c.req.param("id"));
  if (!tok || tok.stall_id !== c.get("user")!.stall_id) return fail(c, 404, "no_token", "Code not found.");
  if (tok.method !== "nfc") return fail(c, 400, "not_nfc", "This code is a QR code; the customer scans it.");
  if (!tok.pending_user_id) return fail(c, 409, "not_tapped", "No one has tapped the sticker yet.");
  const now = Date.now();
  const s = await loadSettings(db);
  const block = await claimBlocker(db, tok, tok.pending_user_id, now, s);
  if (block) return fail(c, ...block);
  const result = await award(db, tok, tok.pending_user_id, now, s, "nfc");
  if (!result) return fail(c, 409, "used", "Already confirmed.");
  const who = await db.prepare("SELECT display_name FROM users WHERE id = ?").bind(tok.pending_user_id).first<string>("display_name");
  return c.json({ claimed_by: who, points: result.points });
});
```

Modify `src/worker/app.ts`: `import { nfc } from "./routes/nfc";` and `app.route("/", nfc);`. Register it **before** `stall`, so `/stall/tokens/:id/confirm` isn't shadowed. Hono matches by method and path, so `GET /stall/tokens/:id` and `POST /stall/tokens/:id/confirm` don't collide either way, but registering early keeps intent clear.

- [ ] **Step 4: Run all tests**

Run: `npx vitest run && npm run typecheck`
Expected: all PASS. The Stage 1 stall test "reports pending, then expired" still passes, because `pending_name` is additive.

- [ ] **Step 5: Commit**

```bash
git add src/worker test/nfc.test.ts
git commit -m "feat(nfc): sticker tap attaches the student, seller confirm awards"
```

---

### Task 3: NFC screens

**Files:**
- Create: `src/app/screens/Tap.tsx`
- Modify: `src/app/screens/Stall.tsx`, `src/app/App.tsx`, `src/app/styles.css`

**Interfaces:**
- Consumes: Task 2 endpoints. `GET /api/stall` already returns `stall.verify_method`.

There are no unit tests for the UI. It is checked by the build and in the browser (Step 5).

- [ ] **Step 1: Styles** (append to `src/app/styles.css`)

```css
.segmented { display: flex; background: var(--panel); border-radius: 12px; padding: 3px; }
.segmented button { flex: 1; appearance: none; border: 0; background: none; padding: 9px; border-radius: 9px; font-size: 14px; color: var(--text-2); cursor: pointer; }
.segmented button[aria-pressed="true"] { background: var(--card); color: var(--text); box-shadow: 0 1px 2px rgba(0,0,0,.08); }
.pulse { width: 120px; height: 120px; border-radius: 50%; background: var(--accent-soft); display: grid; place-items: center; animation: pulse 1.6s ease-in-out infinite; }
.pulse span { font-family: var(--serif); font-size: 18px; color: var(--accent); }
@keyframes pulse { 50% { transform: scale(1.06); opacity: 0.8; } }
```

- [ ] **Step 2: Seller NFC mode in `src/app/screens/Stall.tsx`**
  1. Extend the types:
     - `StallData.stall` gains `verify_method: "qr" | "nfc" | "both"`
     - `Created` gains `method: "qr" | "nfc"`
     - `Status` becomes `{ state: "pending" | "tapped" | "claimed" | "expired"; claimed_by: string | null; pending_name: string | null }`
  2. Add `const [mode, setMode] = useState<"qr" | "nfc">("qr");`, and once data loads, set `mode` to `"nfc"` when `verify_method === "nfc"`: `useEffect(() => { if (data?.stall.verify_method === "nfc") setMode("nfc"); }, [data]);`.
  3. In `sell`, send `method: mode`, and only build the QR for QR tokens: `const qr = t.method === "qr" ? await QRCode.toDataURL(t.claim_url, { margin: 1, width: 560 }) : "";`.
  4. Under the BYO toggle, when `data.stall.verify_method === "both"`, render:

```tsx
        <div className="segmented" role="group" aria-label="How the customer claims">
          <button aria-pressed={mode === "qr"} onClick={() => setMode("qr")}>QR code</button>
          <button aria-pressed={mode === "nfc"} onClick={() => setMode("nfc")}>NFC sticker</button>
        </div>
```
  5. In `QrSheet`:
     - initialise `status` with `pending_name: null`, in both places it's set
     - add a confirm handler and a branch for `active.method === "nfc"`
     - replace the inner conditional (claimed / expired / QR) with:

```tsx
        {status.state === "claimed" ? (
          <>
            <svg className="check" width="92" height="92" viewBox="0 0 92 92" aria-hidden="true">
              <circle cx="46" cy="46" r="40" fill="none" stroke="var(--accent)" strokeWidth="5" />
              <path d="M30 47 l11 11 l21 -23" fill="none" stroke="var(--accent)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p className="body" style={{ color: "var(--text)" }}>Claimed by {status.claimed_by}</p>
          </>
        ) : expired ? (
          <>
            <p className="body">This code expired.</p>
            <button className="btn" onClick={onRegenerate}>New code</button>
          </>
        ) : active.method === "nfc" ? (
          status.state === "tapped" ? (
            <>
              <p className="body" style={{ color: "var(--text)" }}>{status.pending_name} tapped the sticker.</p>
              <button className="btn" disabled={confirming} onClick={confirm}>Confirm</button>
              <p className="muted">Only confirm if they're in front of you.</p>
            </>
          ) : (
            <>
              <div className="pulse"><span>Tap</span></div>
              <p className="muted">Ask the customer to tap their phone on the sticker · <span style={{ fontVariantNumeric: "tabular-nums" }}>{secondsLeft}s</span></p>
            </>
          )
        ) : (
          <>
            <img src={active.qr} alt="Claim QR code" />
            <p className="muted">Scan with your phone camera · <span style={{ fontVariantNumeric: "tabular-nums" }}>{secondsLeft}s</span></p>
          </>
        )}
```
     and, inside `QrSheet`, define:

```tsx
  const [confirming, setConfirming] = useState(false);
  async function confirm() {
    if (confirming) return;
    setConfirming(true);
    try {
      const r = await api<{ claimed_by: string }>(`/stall/tokens/${active.id}/confirm`, {});
      setStatus({ state: "claimed", claimed_by: r.claimed_by, pending_name: null });
    } catch {
      setStatus((s) => ({ ...s }));
    } finally {
      setConfirming(false);
    }
  }
```
  6. Fix the `expired` computation so a tapped token counts down too: `const expired = status.state === "expired" || ((status.state === "pending" || status.state === "tapped") && secondsLeft === 0);`.
  7. Stop the backdrop tap from closing an NFC sheet that's mid-confirm: change the backdrop `onClick={onClose}` to `onClick={status.state === "tapped" ? undefined : onClose}`.

- [ ] **Step 3: Write `src/app/screens/Tap.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api";
import { navigate } from "../router";

type Result = { item_name: string; stall_name: string; low_carbon: boolean; kg_co2e: number | null; points: number; activities: { type: string; points: number }[] };
type Status = { state: "waiting" | "confirmed" | "expired"; stall_name: string; item_name: string; result?: Result };

export function Tap() {
  const started = useRef(false);
  const [tokenId, setTokenId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const stall_id = new URLSearchParams(location.search).get("stall") ?? "";
    api<{ token_id: string; stall_name: string; item_name: string }>("/tap", { stall_id })
      .then((r) => {
        setTokenId(r.token_id);
        setStatus({ state: "waiting", stall_name: r.stall_name, item_name: r.item_name });
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Something went wrong. Tap the sticker again."));
  }, []);

  useEffect(() => {
    if (!tokenId || status?.state !== "waiting") return;
    const t = setInterval(() => api<Status>(`/tap/${tokenId}`).then(setStatus).catch(() => {}), 2000);
    return () => clearInterval(t);
  }, [tokenId, status?.state]);

  if (error) {
    return (
      <div className="result">
        <h1 className="title">Couldn't tap in</h1>
        <p className="body">{error}</p>
        <div style={{ width: "100%", marginTop: 24 }}><button className="btn btn-secondary" onClick={() => navigate("/")}>Go home</button></div>
      </div>
    );
  }
  if (!status) return <p className="muted result">Tapping in…</p>;
  if (status.state === "waiting") {
    return (
      <div className="result">
        <div className="pulse"><span>Wait</span></div>
        <div className="title" style={{ fontSize: 20, marginTop: 16 }}>{status.item_name}</div>
        <p className="muted">{status.stall_name} · waiting for the seller to confirm</p>
      </div>
    );
  }
  if (status.state === "expired" || !status.result) {
    return (
      <div className="result">
        <h1 className="title">The seller didn't confirm in time</h1>
        <p className="body">Ask them to tap the item again, then tap the sticker.</p>
        <div style={{ width: "100%", marginTop: 24 }}><button className="btn btn-secondary" onClick={() => navigate("/")}>Go home</button></div>
      </div>
    );
  }
  const r = status.result;
  const byo = r.activities.find((a) => a.type === "byo");
  const main = r.activities.find((a) => a.type !== "byo");
  const parts = [r.low_carbon && main ? `Low-carbon meal +${main.points}` : null, byo ? `Own container +${byo.points}` : null].filter(Boolean);
  return (
    <div className="result">
      <svg className="check" width="92" height="92" viewBox="0 0 92 92" aria-hidden="true">
        <circle cx="46" cy="46" r="40" fill="none" stroke="var(--accent)" strokeWidth="5" />
        <path d="M30 47 l11 11 l21 -23" fill="none" stroke="var(--accent)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="num-xl" style={{ marginTop: 8 }}>{r.points > 0 ? `+${r.points}` : "Logged"}</div>
      <div className="title" style={{ fontSize: 20 }}>{r.item_name}</div>
      <div className="muted">{r.stall_name}{r.kg_co2e != null && ` · ${r.kg_co2e} kg CO₂e`}</div>
      {parts.length > 0 && <div className="muted" style={{ borderTop: "0.5px solid var(--line)", paddingTop: 12, marginTop: 4, color: "var(--text-2)" }}>{parts.join(" · ")}</div>}
      <div style={{ width: "100%", marginTop: 28 }}><button className="btn" onClick={() => navigate("/")}>Done</button></div>
    </div>
  );
}
```

- [ ] **Step 4: Route `/tap`.** In `src/app/App.tsx`:
  - import `Tap`
  - add `{path === "/tap" && <Tap />}` next to the `/claim` line
  - change `main` to `const main = path !== "/claim" && path !== "/tap" && !path.startsWith("/admin");`

  Like `/claim`, the Welcome screen keeps the URL, so a first-time tapper enters a name and the tap resumes.

- [ ] **Step 5: Build and check in the browser**

Run: `npm run build && npm run typecheck`
Expected: no errors.

Run `npm run db:local`, then start the preview. Seller view: switch to "Noodles seller" (the noodles stall is `both`).
1. The segmented control shows QR code and NFC sticker. Choose NFC and tap "Vegetarian noodles with tofu". The sheet shows the pulsing "Tap" and a countdown.
2. In the same browser, impersonate a student and open `/tap?stall=noodles`. It shows "waiting for the seller to confirm".
3. Switch back to the seller: the sheet shows "<name> tapped the sticker." with Confirm. Tap Confirm and the check appears.
4. Switch to the student and open `/tap?stall=noodles` again. It shows "Ask the seller to tap what you bought first…", because no token is pending.
5. Economy Rice seller (QR-only) shows no segmented control.

The polling student page can't be watched live in one tab while switching. Instead, check the confirmed state by navigating to `/tap?stall=…` after confirming, or with `GET /api/tap/:id` in the console.

- [ ] **Step 6: Commit**

```bash
git add src/app
git commit -m "feat(app): NFC mode for sellers and the student tap screen"
```

---

### Task 4: Mission rewards in settings, and the admin settings API

**Files:**
- Create: `src/worker/routes/admin-settings.ts`, `test/admin-settings.test.ts`
- Modify:
  - `src/worker/lib/missions.ts`, `src/worker/lib/leaderboard.ts`
  - `src/worker/acts.ts`, `src/worker/db.ts`
  - `src/worker/routes/progress.ts`, `src/worker/routes/me.ts`, `src/worker/app.ts`
  - `test/missions.test.ts`

**Interfaces:**
- Produces:
  - `type MissionPoints = Record<string, number>`
  - `currentMissions(acts, now, points?)`, `missionPoints(acts, from, to, points?)`, `periodPoints(acts, from, to, points?)` and `standings(db, from, to, points?)`, all with the optional points map
  - `loadMissionPoints(db): Promise<MissionPoints>`
  - `GET /api/admin/settings` → `{ settings: Settings, missions: { id, name, points, default_points }[] }`
  - `POST /api/admin/settings { values: Record<string, number> }` → same shape | `400 invalid_setting`

- [ ] **Step 1: Write the failing tests**

Append to `test/missions.test.ts`:
```ts
describe("configurable mission rewards", () => {
  it("uses overridden points, including 0", () => {
    const acts = [lowMeal(MON + H)];
    expect(currentMissions(acts, MON + 2 * H, { "daily-low-meal": 35 }).daily[0].points).toBe(35);
    expect(missionPoints(acts, MON, MON + 7 * DAY, { "daily-low-meal": 0 })).toBe(0);
    expect(missionPoints(acts, MON, MON + 7 * DAY, {})).toBe(20);
  });
});
```

`test/admin-settings.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { setup } from "./helpers/setup";

describe("admin settings", () => {
  it("lists every setting and mission reward with defaults", async () => {
    const ctx = await setup();
    const res = await ctx.req("/api/admin/settings", { as: "u-admin" });
    expect(res.status).toBe(200);
    expect(res.body.settings.points_meal_low_carbon).toBe(20);
    expect(res.body.missions.find((m: any) => m.id === "weekly-low-meals")).toMatchObject({ points: 100, default_points: 100 });
  });

  it("saves values, and the new mission reward reaches missions, Today and Ranks consistently", async () => {
    const ctx = await setup();
    const saved = await ctx.req("/api/admin/settings", { as: "u-admin", body: { values: { "mission_points_daily-low-meal": 50, points_meal_low_carbon: 25 } } });
    expect(saved.status).toBe(200);
    expect(saved.body.settings.points_meal_low_carbon).toBe(25);
    expect(saved.body.missions.find((m: any) => m.id === "daily-low-meal").points).toBe(50);

    const uid = (await ctx.req("/api/session", { body: { display_name: "Config" } })).body.user.id;
    ctx.raw.exec(`INSERT INTO activities (id,user_id,category,type,points,verified,source,low_carbon,created_at) VALUES ('c','${uid}','food','meal',25,1,'qr',1,${Date.now() - 1000})`);
    const missions = (await ctx.req("/api/missions", { as: uid })).body;
    expect(missions.daily.find((m: any) => m.id === "daily-low-meal")).toMatchObject({ points: 50, completed: true });
    const today = (await ctx.req("/api/me/summary", { as: uid })).body.points_week;
    const ranks = (await ctx.req("/api/leaderboard", { as: uid })).body.me.points;
    expect(today).toBe(75);
    expect(ranks).toBe(today);
  });

  it.each([
    [{ values: { points_byo: -1 } }],
    [{ values: { points_byo: 1.5 } }],
    [{ values: { points_byo: "10" } }],
    [{ values: { not_a_setting: 5 } }],
    [{ values: { "mission_points_nope": 5 } }],
    [{ values: [] }],
    [{}],
  ])("400 invalid_setting for %j", async (body) => {
    const ctx = await setup();
    const res = await ctx.req("/api/admin/settings", { as: "u-admin", body });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_setting");
  });

  it("is admin-only", async () => {
    const ctx = await setup();
    expect((await ctx.req("/api/admin/settings", { as: "u-alex" })).status).toBe(403);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run test/missions.test.ts test/admin-settings.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement**

In `src/worker/lib/missions.ts`:
- add `export type MissionPoints = Record<string, number>;`
- add a resolver: `const withPoints = (p?: MissionPoints) => (p ? MISSIONS.map((m) => (p[m.id] != null ? { ...m, points: p[m.id] } : m)) : MISSIONS);`
- change `statesFor(period, acts)` to `statesFor(period, acts, list = MISSIONS)`, and filter `list` instead of `MISSIONS`
- `currentMissions(acts, now, points?)`: compute `const list = withPoints(points);` and pass `list` to both `statesFor` calls
- `missionPoints(acts, from, to, points?)`: compute `list` the same way and pass it to `statesFor`

In `src/worker/lib/leaderboard.ts`: `periodPoints(acts, from, to, points?: MissionPoints)` → `missionPoints(acts, from, to, points)`.

In `src/worker/acts.ts`: `standings(db, from, to, points?: MissionPoints)` passes `points` to `periodPoints`. Also make parsing safe: replace `JSON.parse(detail_json || "{}")` with `safeJson(detail_json)`, where

```ts
function safeJson(s: string | null): Record<string, unknown> {
  try {
    const v = JSON.parse(s || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
```

In `src/worker/db.ts`:
```ts
import type { MissionPoints } from "./lib/missions";

const MISSION_PREFIX = "mission_points_";

export async function loadMissionPoints(db: D1Database): Promise<MissionPoints> {
  const { results } = await db.prepare("SELECT key, value FROM settings WHERE key LIKE 'mission_points_%'").all<{ key: string; value: string }>();
  const out: MissionPoints = {};
  for (const r of results) {
    const n = Number(r.value);
    if (Number.isFinite(n)) out[r.key.slice(MISSION_PREFIX.length)] = n;
  }
  return out;
}
```

In `src/worker/routes/progress.ts`: load `const points = await loadMissionPoints(db);` and pass it to `currentMissions(acts, now, points)`, `standings(db, thisWeek - WEEK, thisWeek, points)` (in `/missions`) and `standings(c.env.DB, sgWeekStart(now), now + 1, points)` (in `/leaderboard`).

In `src/worker/routes/me.ts`: add `loadMissionPoints(db)` to the `Promise.all` (destructure it as `missionPts`) and pass it to both `missionPoints(myActs, …, missionPts)` calls.

`src/worker/routes/admin-settings.ts`:
```ts
import { Hono } from "hono";
import { loadMissionPoints, loadSettings } from "../db";
import type { AppEnv } from "../env";
import { fail, readBody } from "../http";
import { MISSIONS } from "../lib/missions";
import { DEFAULT_SETTINGS } from "../lib/settings";
import { requireRole } from "../session";

export const adminSettings = new Hono<AppEnv>();
const admin = requireRole("admin");
const MISSION_KEYS = new Set(MISSIONS.map((m) => `mission_points_${m.id}`));

async function payload(db: D1Database) {
  const [settings, pts] = await Promise.all([loadSettings(db), loadMissionPoints(db)]);
  return { settings, missions: MISSIONS.map((m) => ({ id: m.id, name: m.name, points: pts[m.id] ?? m.points, default_points: m.points })) };
}

adminSettings.get("/admin/settings", admin, async (c) => c.json(await payload(c.env.DB)));

adminSettings.post("/admin/settings", admin, async (c) => {
  const b = await readBody(c);
  const values = b.values;
  const entries = values && typeof values === "object" && !Array.isArray(values) ? Object.entries(values as Record<string, unknown>) : [];
  const ok = entries.length > 0 && entries.every(([k, v]) =>
    (k in DEFAULT_SETTINGS || MISSION_KEYS.has(k)) && typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100_000);
  if (!ok) return fail(c, 400, "invalid_setting", "Each value must be a whole number from 0 to 100,000 for a known setting.");
  const db = c.env.DB;
  await db.batch(entries.map(([k, v]) => db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(k, String(v))));
  return c.json(await payload(db));
});
```

Modify `src/worker/app.ts`: `import { adminSettings } from "./routes/admin-settings";` and `app.route("/", adminSettings);`.

`db.ts` imports a type from `lib/missions.ts`. Seed and Node don't load `db.ts`, so no extension change is needed.

- [ ] **Step 4: Run all tests**

Run: `npx vitest run && npm run typecheck`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/worker test/missions.test.ts test/admin-settings.test.ts
git commit -m "feat(admin): editable points, caps, limits and mission rewards"
```

---

### Task 5: CSV export

**Files:**
- Create: `src/worker/lib/csv.ts`, `src/worker/routes/admin-export.ts`, `test/csv.test.ts`, `test/admin-export.test.ts`
- Modify: `src/worker/app.ts`

**Interfaces:**
- Produces:
  - `toCsv(header: string[], rows: (string | number | null)[][]): string` (RFC 4180, CRLF line ends)
  - `GET /api/admin/export.csv` → `text/csv`, with `content-disposition: attachment; filename="activities-<YYYY-MM-DD>.csv"`

Columns:
- `activity_id`, `user_id`, `category`, `type`, `verified`, `source`, `kg_co2e`, `points`, `low_carbon`
- `stall_id`, `canteen`, `item_id`, `item_name`, `dish`, `mode`, `distance_km`
- `created_at_sgt` (ISO with `+08:00`), `week_start_sgt` (YYYY-MM-DD)

- [ ] **Step 1: Write the failing tests**

`test/csv.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { toCsv } from "../src/worker/lib/csv";

describe("toCsv", () => {
  it("quotes commas, quotes and newlines; empty for null", () => {
    expect(toCsv(["a", "b"], [["x, y", 'say "hi"'], ["line\nbreak", null], [1.5, 0]])).toBe(
      'a,b\r\n"x, y","say ""hi"""\r\n"line\nbreak",\r\n1.5,0\r\n',
    );
  });
  it("neutralises spreadsheet formulas", () => {
    expect(toCsv(["a"], [["=1+1"], ["+cmd"], ["-2"], ["@x"]])).toBe("a\r\n'=1+1\r\n'+cmd\r\n-2\r\n'@x\r\n");
  });
});
```

The `-2` case: a leading `-` followed only by digits is a number and is left alone. Any other value starting with `= + - @` gets a `'` prefix, so Excel won't run it as a formula. This matters because dish names come from AI and from students.

`test/admin-export.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { app } from "../src/worker/app";
import { sign } from "../src/worker/lib/token";
import { setup } from "./helpers/setup";

async function csvAs(ctx: Awaited<ReturnType<typeof setup>>, uid: string) {
  return app.request("https://app.test/api/admin/export.csv", { headers: { cookie: `uid=${encodeURIComponent(await sign(uid, ctx.env.COOKIE_SECRET))}` } }, ctx.env);
}

describe("GET /api/admin/export.csv", () => {
  it("exports every activity with verified and source, as an attachment", async () => {
    const ctx = await setup();
    ctx.raw.exec(`INSERT INTO activities (id,user_id,category,type,points,verified,source,low_carbon,kg_co2e,detail_json,created_at)
      VALUES ('p1','u-alex','food','meal',5,0,'photo',1,0.39,'{"dish":"Noodles, with \\"tofu\\""}',${Date.UTC(2026, 8, 29, 4, 0)})`);
    const res = await csvAs(ctx, "u-admin");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="activities-\d{4}-\d{2}-\d{2}\.csv"/);
    const text = await res.text();
    const [header, ...lines] = text.trim().split("\r\n");
    expect(header).toBe("activity_id,user_id,category,type,verified,source,kg_co2e,points,low_carbon,stall_id,canteen,item_id,item_name,dish,mode,distance_km,created_at_sgt,week_start_sgt");
    const row = lines.find((l) => l.startsWith("p1,"))!;
    expect(row).toBe('p1,u-alex,food,meal,0,photo,0.39,5,1,,,,,"Noodles, with ""tofu""",,,2026-09-29T12:00:00+08:00,2026-09-28');
    expect(lines.length).toBe((ctx.raw.prepare("SELECT COUNT(*) AS n FROM activities").get() as any).n);
  });

  it("is admin-only", async () => {
    const ctx = await setup();
    expect((await csvAs(ctx, "u-alex")).status).toBe(403);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run test/csv.test.ts test/admin-export.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement**

`src/worker/lib/csv.ts`:
```ts
type Cell = string | number | null;

function cell(v: Cell): string {
  if (v == null) return "";
  if (typeof v === "number") return String(v);
  let s = v;
  if (/^[=+\-@]/.test(s) && !/^-\d+(\.\d+)?$/.test(s)) s = `'${s}`; // spreadsheet formula injection
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: Cell[][]): string {
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
```

`src/worker/routes/admin-export.ts`:
```ts
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { toCsv } from "../lib/csv";
import { sgWeekStart } from "../lib/time";
import { requireRole } from "../session";

export const adminExport = new Hono<AppEnv>();
const SG = 8 * 3_600_000;
const sgIso = (ms: number) => new Date(ms + SG).toISOString().replace(/\.\d{3}Z$/, "+08:00");
const sgDate = (ms: number) => new Date(ms + SG).toISOString().slice(0, 10);
const HEADER = ["activity_id", "user_id", "category", "type", "verified", "source", "kg_co2e", "points", "low_carbon", "stall_id", "canteen", "item_id", "item_name", "dish", "mode", "distance_km", "created_at_sgt", "week_start_sgt"];

adminExport.get("/admin/export.csv", requireRole("admin"), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.user_id, a.category, a.type, a.verified, a.source, a.kg_co2e, a.points, a.low_carbon, a.stall_id, s.canteen, a.item_id, i.name AS item_name, a.detail_json, a.created_at
     FROM activities a LEFT JOIN stalls s ON s.id = a.stall_id LEFT JOIN items i ON i.id = a.item_id ORDER BY a.created_at`,
  ).all<Record<string, any>>();
  const rows = results.map((r) => {
    let d: Record<string, unknown> = {};
    try { d = JSON.parse(r.detail_json || "{}") ?? {}; } catch { /* keep {} */ }
    const str = (v: unknown) => (typeof v === "string" ? v : null);
    const num = (v: unknown) => (typeof v === "number" ? v : null);
    return [r.id, r.user_id, r.category, r.type, r.verified, r.source, r.kg_co2e, r.points, r.low_carbon, r.stall_id, r.canteen, r.item_id, r.item_name,
      str(d.dish), str(d.mode), num(d.distance_km), sgIso(r.created_at), sgDate(sgWeekStart(r.created_at))];
  });
  return c.body(toCsv(HEADER, rows), 200, {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="activities-${sgDate(Date.now())}.csv"`,
  });
});
```

Modify `src/worker/app.ts`: `import { adminExport } from "./routes/admin-export";` and `app.route("/", adminExport);`.

- [ ] **Step 4: Run all tests**

Run: `npx vitest run && npm run typecheck`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/worker test/csv.test.ts test/admin-export.test.ts
git commit -m "feat(admin): CSV export of activities for the pilot evaluation"
```

---

### Task 6: Admin stalls and items API

**Files:**
- Modify: `src/worker/routes/admin-menu.ts`, `test/admin-menu.test.ts`

**Interfaces:**
- Produces:
  - `GET /api/admin/stalls` now also returns `active: boolean` and `verify_method`
  - `POST /api/admin/stalls/:id { active?: boolean, verify_method?: "qr" | "nfc" | "both" }` → `{ stall }`
  - `POST /api/admin/items { stall_id, name, kind, parts }` → 201 `{ item }` (draft)
  - Deleting a referenced item → `409 in_use`
  - New draft ids use an 8-character suffix

- [ ] **Step 1: Write the failing tests** (append inside `describe("admin menu import")` in `test/admin-menu.test.ts`)

```ts
  it("updates a stall's active flag and verify method", async () => {
    const ctx = await setup();
    const res = await ctx.req("/api/admin/stalls/econ-rice", { as: "u-admin", body: { active: false, verify_method: "both" } });
    expect(res.body.stall).toMatchObject({ id: "econ-rice", active: false, verify_method: "both" });
    expect((await ctx.req("/api/admin/stalls/econ-rice", { as: "u-admin", body: { verify_method: "laser" } })).body.error).toBe("invalid_stall");
    expect((await ctx.req("/api/admin/stalls/nope", { as: "u-admin", body: { active: true } })).status).toBe(404);
  });

  it("creates a draft item by hand with kg from factors", async () => {
    const ctx = await setup();
    const res = await ctx.req("/api/admin/items", { as: "u-admin", body: { stall_id: "noodles", name: "Tofu laksa", kind: "meal", parts: { wheat: 100, tofu: 80, veg: 60 } } });
    expect(res.status).toBe(201);
    expect(res.body.item).toMatchObject({ name: "Tofu laksa", status: "draft", low_carbon: true, kg_co2e: 0.44 });
    expect(res.body.item.id).toMatch(/^noodles-tofu-laksa-[0-9a-f]{8}$/);
    expect((await ctx.req("/api/admin/items", { as: "u-admin", body: { stall_id: "noodles", name: "", kind: "meal", parts: {} } })).body.error).toBe("invalid_item");
  });

  it("refuses to delete an item that activities or tokens refer to", async () => {
    const ctx = await setup();
    await ctx.req("/api/admin/items/econ-veg-egg", { as: "u-admin", body: { status: "draft" } });
    const res = await ctx.req("/api/admin/items/econ-veg-egg/delete", { as: "u-admin", body: {} });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("in_use");
  });
```

The `econ-veg-egg` item has seeded persona history, so it's referenced. Tofu laksa kg: 100 × 1.57 + 80 × 3.16 + 60 × 0.43 = 157 + 252.8 + 25.8 = 435.6 g → 0.44 kg.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run test/admin-menu.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement** in `src/worker/routes/admin-menu.ts`
  1. `GET /admin/stalls`: select `id, name, canteen, active, verify_method` and map `active: r.active === 1`.
  2. Add the stall update:

```ts
adminMenu.post("/admin/stalls/:id", admin, async (c) => {
  const db = c.env.DB;
  const cur = await db.prepare("SELECT id, name, canteen, active, verify_method FROM stalls WHERE id = ?").bind(c.req.param("id")).first<{ id: string; name: string; canteen: string; active: number; verify_method: string }>();
  if (!cur) return fail(c, 404, "no_stall", "That stall doesn't exist.");
  const b = await readBody(c);
  const bad = ("active" in b && typeof b.active !== "boolean") || ("verify_method" in b && !["qr", "nfc", "both"].includes(b.verify_method as string));
  if (bad) return fail(c, 400, "invalid_stall", "Active must be on or off; verify method must be QR, NFC or both.");
  const active = "active" in b ? (b.active ? 1 : 0) : cur.active;
  const vm = "verify_method" in b ? (b.verify_method as string) : cur.verify_method;
  await db.prepare("UPDATE stalls SET active = ?, verify_method = ? WHERE id = ?").bind(active, vm, cur.id).run();
  return c.json({ stall: { id: cur.id, name: cur.name, canteen: cur.canteen, active: active === 1, verify_method: vm } });
});
```
  3. Add item creation, reusing `slug`, `assess` and `factorTable`. In `/admin/menu/photo` too, change the id suffix to `crypto.randomUUID().slice(0, 8)`:

```ts
adminMenu.post("/admin/items", admin, async (c) => {
  const db = c.env.DB;
  const b = await readBody(c);
  const stall = typeof b.stall_id === "string" ? await db.prepare("SELECT id FROM stalls WHERE id = ?").bind(b.stall_id).first<{ id: string }>() : null;
  if (!stall) return fail(c, 404, "no_stall", "Pick a stall first.");
  const name = typeof b.name === "string" ? b.name.trim() : "";
  const kind = b.kind === "drink" ? "drink" : b.kind === "meal" ? "meal" : null;
  const partsOk = b.parts && typeof b.parts === "object" && !Array.isArray(b.parts);
  if (name.length < 1 || name.length > 80 || !kind || !partsOk) return fail(c, 400, "invalid_item", "Check the name, kind, ingredients and status.");
  const parts = cleanParts(b.parts);
  const a = assess(kind, parts, await factorTable(db));
  const id = `${stall.id}-${slug(name)}-${crypto.randomUUID().slice(0, 8)}`;
  await db.prepare("INSERT INTO items (id, stall_id, name, kind, parts_json, kg_co2e, low_carbon, points, status) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'draft')")
    .bind(id, stall.id, name, kind, JSON.stringify(parts), a.kg_co2e, a.low_carbon).run();
  return c.json({ item: shape({ id, stall_id: stall.id, name, kind, parts_json: JSON.stringify(parts), kg_co2e: a.kg_co2e, low_carbon: a.low_carbon, status: "draft" }) }, 201);
});
```
  4. In the delete route, after the draft check, add:

```ts
  const used = await db.prepare("SELECT (SELECT COUNT(*) FROM activities WHERE item_id = ?1) + (SELECT COUNT(*) FROM tokens WHERE item_id = ?1) AS n").bind(c.req.param("id")).first<number>("n");
  if ((used ?? 0) > 0) return fail(c, 409, "in_use", "Students have already logged this item, so it can't be deleted. Keep it as a draft to hide it.");
```

Register `POST /admin/items` **before** `POST /admin/items/:id` in the file, so the bare path isn't treated as an id.

- [ ] **Step 4: Run all tests**

Run: `npx vitest run && npm run typecheck`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/worker test/admin-menu.test.ts
git commit -m "feat(admin): edit stalls, add items, protect referenced items"
```

---

### Task 7: Ingredient text helpers

**Files:**
- Modify: `src/app/copy.ts`, `test/copy.test.ts`

**Interfaces:**
- Produces:
  - `parsePartsText(text: string): { parts: Record<string, number>; unknown: string[] }`
  - `formatParts(parts: Record<string, number>): string`
  - `PART_KEYS: string[]` (the 13 factor keys)

- [ ] **Step 1: Write the failing test** (append to `test/copy.test.ts`)

```ts
import { formatParts, parsePartsText } from "../src/app/copy";

describe("ingredient text", () => {
  it("parses 'key grams' pairs separated by commas or new lines", () => {
    expect(parsePartsText("rice 80, veg 150\neggs 50g")).toEqual({ parts: { rice: 80, veg: 150, eggs: 50 }, unknown: [] });
  });
  it("reports unknown or malformed entries", () => {
    expect(parsePartsText("rice 80, chilli 5, tofu")).toEqual({ parts: { rice: 80 }, unknown: ["chilli 5", "tofu"] });
  });
  it("formats parts back to text", () => {
    expect(formatParts({ rice: 80, veg: 150 })).toBe("rice 80, veg 150");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/copy.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement** (append to `src/app/copy.ts`)

```ts
export const PART_KEYS = ["rice", "wheat", "poultry", "pork", "beef_herd", "beef_dairy", "fish_farmed", "eggs", "tofu", "milk", "coffee", "cane_sugar", "veg"];

export function parsePartsText(text: string): { parts: Record<string, number>; unknown: string[] } {
  const parts: Record<string, number> = {};
  const unknown: string[] = [];
  for (const raw of text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)) {
    const m = /^([a-z_]+)\s+(\d+(?:\.\d+)?)\s*g?$/i.exec(raw);
    if (m && PART_KEYS.includes(m[1].toLowerCase())) parts[m[1].toLowerCase()] = Number(m[2]);
    else unknown.push(raw);
  }
  return { parts, unknown };
}

export function formatParts(parts: Record<string, number>): string {
  return Object.entries(parts).map(([k, g]) => `${k} ${g}`).join(", ");
}
```

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/copy.ts test/copy.test.ts
git commit -m "feat(app): ingredient text parse and format helpers"
```

---

### Task 8: Admin hub, stalls and items editor, settings screen, export link

**Files:**
- Create: `src/app/screens/AdminStalls.tsx`, `src/app/screens/AdminSettings.tsx`
- Modify: `src/app/screens/Admin.tsx`, `src/app/screens/MenuImport.tsx`, `src/app/App.tsx`

**Interfaces:**
- Consumes: Tasks 4, 5, 6 and 7, plus `/admin/items` (Stage 3)

There are no unit tests for the UI. It is checked by the build and in the browser (Step 5).

- [ ] **Step 1: Admin hub.** In `src/app/screens/Admin.tsx`, accept `{ isAdmin }: { isAdmin: boolean }`. Replace the single menu-import button with a tools block shown only when `isAdmin`:

```tsx
      {isAdmin && (
        <div className="panel" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => navigate("/admin/stalls")}>Stalls and items</button>
          <button className="btn btn-secondary" onClick={() => navigate("/admin/menu")}>Import a menu from a photo</button>
          <button className="btn btn-secondary" onClick={() => navigate("/admin/settings")}>Points and limits</button>
          <a className="btn btn-secondary" style={{ textAlign: "center", textDecoration: "none" }} href="/api/admin/export.csv" download>Export activities (CSV)</a>
        </div>
      )}
```
Change the heading to `{isAdmin ? "Admin" : "Switch persona"}`, and add a section head above the list: `<div className="section-head">Switch persona</div>`.

In `App.tsx`, pass `isAdmin={role === "admin"}` to both `<Admin />` usages, and add the routes before `/admin`:
```tsx
      {path === "/admin/stalls" && role === "admin" && <AdminStalls />}
      {path === "/admin/settings" && role === "admin" && <AdminSettings />}
```
with the imports.

- [ ] **Step 2: Write `src/app/screens/AdminStalls.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api";
import { formatParts, parsePartsText } from "../copy";

type Stall = { id: string; name: string; canteen: string; active: boolean; verify_method: "qr" | "nfc" | "both" };
type Item = { id: string; name: string; kind: "meal" | "drink"; parts: Record<string, number>; kg_co2e: number | null; low_carbon: boolean; status: "draft" | "live" };

export function AdminStalls() {
  const [stalls, setStalls] = useState<Stall[]>([]);
  const [stallId, setStallId] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", kind: "meal" as "meal" | "drink", parts: "" });
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const stall = stalls.find((s) => s.id === stallId) ?? null;

  const loadStalls = () => api<{ stalls: Stall[] }>("/admin/stalls").then((d) => setStalls(d.stalls));
  const loadItems = (id = stallId) => (id ? api<{ items: Item[] }>(`/admin/items?stall_id=${encodeURIComponent(id)}`).then((d) => setItems(d.items)) : Promise.resolve(setItems([])));
  useEffect(() => { loadStalls().catch(() => setError("Admins only. Switch back to the admin account.")); }, []);
  useEffect(() => { setEditing(null); loadItems().catch(() => setItems([])); }, [stallId]);

  async function run(fn: () => Promise<string | null>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    setNote(null);
    try { setNote(await fn()); } catch (e) { setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again."); } finally { inFlight.current = false; }
  }

  function startEdit(i: Item | null) {
    setEditing(i ? i.id : "new");
    setDraft(i ? { name: i.name, kind: i.kind, parts: formatParts(i.parts) } : { name: "", kind: "meal", parts: "" });
  }

  function save() {
    const { parts, unknown } = parsePartsText(draft.parts);
    if (unknown.length) return setError(`Unknown ingredients: ${unknown.join(", ")}. Use: rice, wheat, poultry, pork, beef_herd, beef_dairy, fish_farmed, eggs, tofu, milk, coffee, cane_sugar, veg.`);
    run(async () => {
      if (editing === "new") await api("/admin/items", { stall_id: stallId, name: draft.name, kind: draft.kind, parts });
      else await api(`/admin/items/${editing}`, { name: draft.name, kind: draft.kind, parts });
      setEditing(null);
      await loadItems();
      return "Saved. kg recalculated from the factor table.";
    });
  }

  const stickerUrl = stall ? `${location.origin}/tap?stall=${stall.id}` : "";

  return (
    <>
      <div>
        <div className="eyebrow">Admin</div>
        <h1 className="display" style={{ marginTop: 8 }}>Stalls and items.</h1>
      </div>
      {error && <p className="error">{error}</p>}
      {note && <div className="toast" role="status">{note}</div>}
      <select value={stallId} onChange={(e) => setStallId(e.target.value)}>
        <option value="">Choose a stall</option>
        {stalls.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.canteen}</option>)}
      </select>

      {stall && (
        <div className="panel" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label className="toggle-row" style={{ borderTop: 0, padding: 0 }}>
            <span>Taking claims</span>
            <span className="switch">
              <input type="checkbox" checked={stall.active} onChange={(e) => run(async () => { await api(`/admin/stalls/${stall.id}`, { active: e.target.checked }); await loadStalls(); return null; })} aria-label="Taking claims" />
              <span />
            </span>
          </label>
          <div>
            <p className="field-label">How customers claim</p>
            <select value={stall.verify_method} onChange={(e) => run(async () => { await api(`/admin/stalls/${stall.id}`, { verify_method: e.target.value }); await loadStalls(); return null; })}>
              <option value="qr">QR code</option>
              <option value="nfc">NFC sticker</option>
              <option value="both">Both</option>
            </select>
          </div>
          {stall.verify_method !== "qr" && (
            <div>
              <p className="field-label">Write this link to the stall's NFC sticker</p>
              <div className="inline">
                <input type="text" readOnly value={stickerUrl} />
                <button className="btn btn-secondary" onClick={() => navigator.clipboard?.writeText(stickerUrl).then(() => setNote("Link copied."))}>Copy</button>
              </div>
            </div>
          )}
        </div>
      )}

      {stall && (
        <div className="list">
          {items.map((i) => (
            <div key={i.id} className="row" style={{ alignItems: "center" }}>
              <div>
                <div className="what">{i.name}</div>
                <div className="meta">{i.status} · {i.kind} · {i.kg_co2e == null ? "kg unknown" : `${i.kg_co2e} kg`}{i.low_carbon ? " · low-carbon" : ""}</div>
              </div>
              <div className="inline">
                <button className="link-btn" onClick={() => startEdit(i)}>Edit</button>
                <button className="link-btn" onClick={() => run(async () => { await api(`/admin/items/${i.id}`, { status: i.status === "live" ? "draft" : "live" }); await loadItems(); return null; })}>
                  {i.status === "live" ? "Hide" : "Approve"}
                </button>
              </div>
            </div>
          ))}
          <button className="btn btn-secondary" style={{ marginTop: 12 }} onClick={() => startEdit(null)}>Add an item</button>
        </div>
      )}

      {editing && (
        <div className="estimate">
          <span className="tag">{editing === "new" ? "New item (starts as a draft)" : "Edit item"}</span>
          <input type="text" placeholder="Name" value={draft.name} maxLength={80} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as "meal" | "drink" })}>
            <option value="meal">Meal</option>
            <option value="drink">Drink</option>
          </select>
          <textarea
            rows={3}
            placeholder="rice 80, veg 150, eggs 50"
            value={draft.parts}
            onChange={(e) => setDraft({ ...draft, parts: e.target.value })}
            style={{ width: "100%", padding: 14, borderRadius: 14, border: "0.5px solid var(--line)", font: "inherit", fontSize: 15 }}
          />
          <p className="muted">Grams per portion. Rice and noodles dry weight.</p>
          <div className="inline">
            <button className="btn btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn" onClick={save}>Save</button>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 3: Write `src/app/screens/AdminSettings.tsx`**

```tsx
import { useEffect, useState } from "react";
import { api, ApiError } from "../api";

type Payload = { settings: Record<string, number>; missions: { id: string; name: string; points: number; default_points: number }[] };

const LABELS: Record<string, string> = {
  points_meal_low_carbon: "Low-carbon stall meal",
  points_byo: "Own cup or container",
  points_photo_low_carbon: "Photo meal (low-carbon)",
  points_walk_trip: "Walk trip",
  points_shuttle_trip: "Shuttle trip",
  points_container_return: "Container return (each)",
  self_reported_daily_cap: "Daily cap on self-reported points",
  rate_stall_window_min: "Minutes between claims at one stall",
  rate_daily_max: "Stall claims per day",
  token_ttl_sec: "Code lifetime (seconds)",
};

export function AdminSettings() {
  const [data, setData] = useState<Payload | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = (p: Payload) => {
    setData(p);
    setValues({
      ...Object.fromEntries(Object.entries(p.settings).map(([k, v]) => [k, String(v)])),
      ...Object.fromEntries(p.missions.map((m) => [`mission_points_${m.id}`, String(m.points)])),
    });
  };
  useEffect(() => { api<Payload>("/admin/settings").then(apply).catch(() => setError("Admins only. Switch back to the admin account.")); }, []);

  async function save() {
    setError(null);
    setNote(null);
    try {
      const out = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Number(v)]));
      apply(await api<Payload>("/admin/settings", { values: out }));
      setNote("Saved. New values apply immediately.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save.");
    }
  }

  if (!data) return error ? <p className="error">{error}</p> : null;
  const field = (key: string, label: string) => (
    <div className="row" key={key} style={{ alignItems: "center" }}>
      <span className="what" style={{ fontSize: 15 }}>{label}</span>
      <input type="text" inputMode="numeric" value={values[key] ?? ""} onChange={(e) => setValues({ ...values, [key]: e.target.value.replace(/\D/g, "") })} style={{ width: 96, textAlign: "right" }} aria-label={label} />
    </div>
  );

  return (
    <>
      <div>
        <div className="eyebrow">Admin</div>
        <h1 className="display" style={{ marginTop: 8 }}>Points and limits.</h1>
      </div>
      {error && <p className="error">{error}</p>}
      {note && <div className="toast" role="status">{note}</div>}
      <div>
        <div className="section-head">Points, caps and limits</div>
        <div className="list">{Object.keys(LABELS).map((k) => field(k, LABELS[k]))}</div>
      </div>
      <div>
        <div className="section-head">Mission rewards</div>
        <div className="list">{data.missions.map((m) => field(`mission_points_${m.id}`, m.name))}</div>
      </div>
      <button className="btn" onClick={save}>Save</button>
    </>
  );
}
```

- [ ] **Step 4: Menu import screen.** In `MenuImport.tsx`, add a line under the drafts list: `<p className="muted">To fix a dish's name or ingredients before approving, use Stalls and items.</p>`.

- [ ] **Step 5: Build and check in the browser**

Run: `npm run build && npm run typecheck && npx vitest run`
Expected: no errors, all PASS.

As a real admin (Snapper locally, or a Simon admin on live), at 375 px:
1. Admin shows the four tools above the persona list.
2. Stalls and items → Noodles: turn "Taking claims" off and on, set it to "Both", and the NFC sticker link appears and copies.
3. Edit "Vegetarian noodles with tofu" and change the parts to `wheat 100, veg 120, tofu 60`. Save: the toast appears and the kg updates (0.40).
4. Add an item "Tofu laksa" with `wheat 100, tofu 80, veg 60`. It appears as a draft at 0.44 kg; Approve makes it live.
5. Enter `chilli 5` in parts. The error lists the allowed keys.
6. Points and limits: change "Eat one low-carbon meal today" to 30 and Save. The Missions tab for a student shows +30.
7. Export activities (CSV) downloads a file that opens in a spreadsheet.
8. As a switched student persona, `/admin` shows only the persona list.

- [ ] **Step 6: Commit**

```bash
git add src/app
git commit -m "feat(app): admin hub with stalls and items editor, settings and export"
```

---

### Task 9: Let students edit the dish name

**Files:**
- Modify: `src/app/components/MealPhoto.tsx`

There are no unit tests for the UI. The API already accepts any dish name of 1–80 characters, so this is a browser check (Step 2).

- [ ] **Step 1: Make the dish editable.** In the estimate card, replace `<div className="title" style={{ fontSize: 20 }}>{estimate.dish}</div>` with:

```tsx
          <input
            type="text"
            aria-label="Dish name"
            value={estimate.dish}
            maxLength={80}
            onChange={(e) => setEstimate({ ...estimate, dish: e.target.value })}
            style={{ fontFamily: "var(--serif)", fontSize: 20, padding: "8px 12px" }}
          />
          <span className="tag">Fix the name if it's wrong. Points and kg come from the estimate above.</span>
```
and disable "Log meal" when `estimate.dish.trim() === ""`.

- [ ] **Step 2: Build and check in the browser**

Run: `npm run build && npm run typecheck`. Then, as a student: Snap a meal → edit the name to "Mee goreng" → Log meal. Today's Recent shows "Mee goreng".

- [ ] **Step 3: Commit**

```bash
git add src/app/components/MealPhoto.tsx
git commit -m "feat(app): students can correct the dish name before logging"
```

---

### Task 10: Hardening

**Files:**
- Modify:
  - `src/worker/routes/ai.ts`, `src/worker/routes/admin-menu.ts`
  - `src/worker/image.ts`, `src/worker/lib/ai-tasks.ts`
  - `test/ai-routes.test.ts`, `test/ai-tasks.test.ts`

**Interfaces:**
- Produces:
  - Photo routes reject bodies over 3 MB with `413 too_large` before parsing.
  - The base64 decode uses a loop.
  - The nudge prompt asks for 2–3 sentences and includes the swap when one is given.

- [ ] **Step 1: Write the failing tests**

Append to `test/ai-routes.test.ts`:
```ts
describe("upload size", () => {
  it("rejects photo bodies over 3 MB with 413 before parsing", async () => {
    const ctx = await setup();
    const { app } = await import("../src/worker/app");
    const { sign } = await import("../src/worker/lib/token");
    const big = JSON.stringify({ image: { mime: "image/png", base64: "A".repeat(3_200_000) } });
    const res = await app.request("https://app.test/api/meals/photo", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(big.length), cookie: `uid=${encodeURIComponent(await sign("u-alex", ctx.env.COOKIE_SECRET))}` },
      body: big,
    }, ctx.env);
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe("too_large");
  });
});
```

Append to `test/ai-tasks.test.ts`, inside `describe("nudge")`:
```ts
  it("prompt asks for 2–3 sentences and to mention the swap", async () => {
    const { NUDGE_PROMPT } = await import("../src/worker/lib/ai-tasks");
    expect(NUDGE_PROMPT).toMatch(/two or three/i);
    expect(NUDGE_PROMPT).toMatch(/swap/i);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run test/ai-routes.test.ts test/ai-tasks.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement**

In both `src/worker/routes/ai.ts` and `src/worker/routes/admin-menu.ts`:
```ts
import { bodyLimit } from "hono/body-limit";

const photoLimit = bodyLimit({
  maxSize: 3 * 1024 * 1024,
  onError: (c) => c.json({ error: "too_large", message: "That photo is too large. Try again; the app shrinks photos first." }, 413),
});
```
and add `photoLimit` as the first middleware on `ai.post("/meals/photo", photoLimit, student, …)` and `adminMenu.post("/admin/menu/photo", photoLimit, admin, …)`.

In `src/worker/image.ts`, replace the `Uint8Array.from(atob(base64), …)` line with:
```ts
    const bin = atob(base64);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
```

In `src/worker/lib/ai-tasks.ts`, set:
```ts
export const NUDGE_PROMPT =
  `You write two or three short, warm, specific sentences for a university student about their week's food and travel footprint. ` +
  `If a swap is given, end with it, including the kg it saves. Use only the numbers given; do not invent facts or numbers. ` +
  `No emoji, no exclamation marks. Reply only with JSON {"text": string}.`;
```

- [ ] **Step 4: Run all tests**

Run: `npx vitest run && npm run typecheck`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/worker test/ai-routes.test.ts test/ai-tasks.test.ts
git commit -m "fix: 3 MB upload limit, faster decode, nudge prompt per spec"
```

---

### Task 11: Polish and consistency

**Files:**
- Modify: `src/app/screens/Ranks.tsx`, `src/app/screens/Missions.tsx`, `test/admin-settings.test.ts` (already covers Today = Ranks under changed settings), `test/progress.test.ts`

- [ ] **Step 1: Write the failing test.** Add to `test/progress.test.ts` (inside `describe("GET /api/leaderboard")`):

```ts
  it("shows the same points on Today and Ranks for a student with mixed activity", async () => {
    const ctx = await setup();
    const uid = await student(ctx, "Same");
    add(ctx, uid, "x1", "meal", { low: 1, points: 20 });
    add(ctx, uid, "x2", "byo", { points: 15 });
    await ctx.req("/api/trips", { as: uid, body: { from_id: "hive", to_id: "north-spine", mode: "walk" } });
    const today = (await ctx.req("/api/me/summary", { as: uid })).body.points_week;
    const ranks = (await ctx.req("/api/leaderboard", { as: uid })).body.me.points;
    expect(ranks).toBe(today);
    expect(today).toBeGreaterThan(45);
  });
```

Run: `npx vitest run test/progress.test.ts`
Expected: PASS. This pins existing behaviour the Stage 2b review asked to lock in; a failure here is a real bug to fix before continuing.

- [ ] **Step 2: Copy and accessibility**
  - `Ranks.tsx`: change the footnote to `Points from meals, your own cup, trips, returns and mission bonuses. Resets every Monday.`
  - `Missions.tsx`: on the progress `div`, replace `aria-label=…` with `role="progressbar" aria-valuemin={0} aria-valuemax={m.target} aria-valuenow={m.progress} aria-label={m.name}`.

- [ ] **Step 3: Build and commit**

Run: `npm run build && npm run typecheck && npx vitest run`
Expected: no errors, all PASS.

```bash
git add src/app test/progress.test.ts
git commit -m "chore: Today=Ranks test, Ranks copy, progressbar semantics"
```

---

### Task 12: Docs, spec and deploy

This deploys the approved app. No migration is needed: the `tokens` NFC columns and `settings` exist from Stage 1.

**Files:**
- Modify: `docs/demo-checklist.md`, `docs/superpowers/specs/2026-09-29-campus-carbon-app-design.md` (§8.2, §11)

- [ ] **Step 1: Demo checklist.** Append to `docs/demo-checklist.md`:

```markdown

## Stage 2–4 checks (real phones)

- [ ] Today → Snap a meal → photo of a real dish → "AI estimate" card → edit the name if needed → Log meal → appears in Recent
- [ ] Log → type "hive to hall 11" → Find → both places filled → tap Walk → +10
- [ ] Missions shows today's and this week's missions; Ranks shows you highlighted
- [ ] NFC (needs a sticker written with the stall link from Admin → Stalls and items):
  - [ ] Seller (stall set to NFC or Both) chooses NFC sticker, taps an item → "Tap" pulse
  - [ ] iPhone (XS or later, unlocked, camera closed) taps the sticker → Safari opens /tap → "waiting for the seller"
  - [ ] Seller sees the name → Confirm → student screen shows the points
  - [ ] Android with NFC on: same flow
  - [ ] Note confirm time from the export (`confirmed_at` − `created_at` is on the token; activity time is the confirm)
- [ ] Admin → Export activities (CSV) opens in a spreadsheet; verified and source columns present
- [ ] Gemini down? The app shows "Offline estimate" and photo meals earn 0. Re-check later; nothing else breaks.
```

- [ ] **Step 2: Spec notes.** In §8.2, after step 4, add:
`Implemented: the seller's sheet shows the tapping student's name with Confirm. The student's page waits and shows the points after Confirm. Rate limits are checked at tap and again at Confirm. A new NFC token at a stall expires the previous pending one.`

In §11 under Admin, add:
`Implemented: Stalls and items (active, verify method, NFC sticker link, edit and add items with ingredients in grams, approve and hide), Points and limits (all settings, including mission rewards), CSV export, menu photo import. Admin tools need the real admin role. A switched persona sees only the persona list.`

- [ ] **Step 3: Deploy and smoke-test**

```bash
npm run deploy
curl -s https://campus-carbon.stan322.workers.dev/api/health
```
Expected: `{"ok":true}`.

On the live site as a Simon admin, open Admin → Points and limits (it loads), and check the Stalls and items list loads.

- [ ] **Step 4: Commit**

```bash
git add docs
git commit -m "docs: stage 4 demo checklist and spec notes"
```
