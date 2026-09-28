# Stage 1: Foundation and QR Claim — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployed Cloudflare Worker app where a seller taps an item, a student scans the QR code with a phone camera, and the student gets verified points for a low-carbon meal and BYO. It also includes seeded personas, an admin persona switcher, and a basic student home screen.

**Architecture:** One Cloudflare Worker serves the React SPA as static assets and a Hono API under `/api/*`, backed by D1. All rules (carbon maths, HMAC signing, points, Singapore-time week boundaries) live in pure modules under `src/worker/lib/` with unit tests. Route handlers are thin. API integration tests run in plain Vitest on Node, against a small D1-compatible adapter over `node:sqlite` that applies the real migration SQL.

**Tech Stack:** TypeScript 5.9, Hono 4, React 19, Vite 8, `@cloudflare/vite-plugin` 1.x, Wrangler 4, D1, Vitest 5, `qrcode` 1.5, Node 25 (runs `.ts` scripts natively).

**Spec:** `docs/superpowers/specs/2026-09-29-campus-carbon-app-design.md`

**Later stages** get their own plans after this one ships, as spec §17 describes:
- Stage 2: trips, steps, returns, missions, streaks, badges, leaderboard, budget
- Stage 3: AI
- Stage 4: NFC, CSV export, settings UI, liquid-glass polish

## Global Constraints

- Tokens expire after `token_ttl_sec` = 90 seconds (spec §8.1).
- Rate limits: 1 verified claim per stall per 10 min; 5 verified claims per day (spec §8.1).
- Points (spec §7):
  - low-carbon stall meal +20
  - other stall meal 0
  - stall drink 0
  - BYO +15
- The `settings` table overrides these. Defaults live in `src/worker/lib/settings.ts`.
- Low-carbon meal rule: `parts` contains none of `poultry`, `pork`, `beef_herd`, `beef_dairy`, `fish_farmed` (spec §7). Drinks are never classified low-carbon.
- Weeks run Monday 00:00 to Sunday 23:59, Asia/Singapore (UTC+8, no DST) (spec §10).
- A null `kg_co2e` means "not estimable". Never coerce it to 0.
- Sellers and admins cannot claim (spec §5).
- No stack traces in responses. Every error body is `{ error: <code>, message: <plain sentence> }`.
- Timestamps are INTEGER milliseconds since epoch. Booleans are stored as INTEGER 0/1, always converted explicitly before `.bind()`.
- IDs:
  - users and tokens: `crypto.randomUUID()`
  - stalls and items: readable slugs from seed
- Visual design (spec §12):
  - off-white background `#F7F7F5`, white cards, one green accent
  - system font stack `-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif`
  - glass only on floating chrome
- Do not use the Web NFC API.
- Do not invent emission factors. Mobility factors are seeded as `NULL`.

## Review Focus

1. **Two phones scan the same QR at once.** Exactly one gets points and the other sees "already used". Pinned in Task 9 (concurrent-claim test).
2. **A student opens a claim link with no account yet.** The API answers `401 no_session` without using the token. The app shows the name screen, then finishes the claim. API side pinned in Task 9; UI checked manually in Task 13.
3. **Malformed or tampered `t` values** (empty, no dot, wrong signature, not a string, missing). Each returns `400 invalid_token`, never a 500. Pinned in Tasks 4 and 9.
4. **A seller makes a code for another stall's item, or a hidden (`draft`) item.** Rejected with `403 wrong_stall` or `404 no_item`. Pinned in Task 8.
5. **A drink with unknown kg** (Teh-O kosong). The claim succeeds and the activity stores `kg_co2e = NULL`, not 0. Pinned in Task 9.

---

## File Structure

```
package.json, tsconfig.json, vite.config.ts, vitest.config.ts, wrangler.jsonc
.gitignore, .dev.vars.example, index.html
migrations/0001_init.sql             full schema from spec §6
seed/data.ts                         factors, stalls, items, users (typed data only)
seed/sql.ts                          buildSeedSql(now) → SQL string
seed/build-sql.ts                    CLI: prints buildSeedSql() to stdout
src/worker/index.ts                  Worker entry: export default app
src/worker/app.ts                    Hono app, /api base, middleware, error handling, route mounting
src/worker/env.ts                    Bindings, User, AppEnv types
src/worker/http.ts                   fail() error-response helper
src/worker/session.ts                session middleware, startSession, requireRole, requireSwitcher
src/worker/db.ts                     loadSettings(db)
src/worker/activities.ts             insertActivity(db, a) → prepared statement
src/worker/routes/auth.ts            /session, /me, /admin/users, /admin/impersonate
src/worker/routes/stall.ts           /stall, /stall/tokens, /stall/tokens/:id
src/worker/routes/claim.ts           /claim
src/worker/routes/me.ts              /me/summary
src/worker/lib/carbon.ts             computeKg, isLowCarbonMeal, HIGH_CARBON_PROTEINS
src/worker/lib/token.ts              sign, verify (HMAC-SHA256, base64url)
src/worker/lib/time.ts               sgDayStart, sgWeekStart
src/worker/lib/settings.ts           DEFAULT_SETTINGS, Settings, parseSettings
src/worker/lib/scoring.ts            stallClaimPoints, byoPoints
src/app/main.tsx, App.tsx            SPA entry and top-level routing
src/app/api.ts                       fetch wrapper, ApiError, shared response types
src/app/router.ts                    usePath, navigate (no router dependency)
src/app/styles.css                   design tokens and base components
src/app/screens/Welcome.tsx          display-name onboarding
src/app/screens/Home.tsx             student home: points and recent activity
src/app/screens/Stall.tsx            seller item grid, BYO toggle, QR sheet
src/app/screens/Claim.tsx            claim result / error
src/app/screens/Admin.tsx            persona switcher
test/helpers/d1.ts                   node:sqlite → D1 adapter, createTestD1()
test/helpers/setup.ts                setup(): seeded DB, env, req() client
test/*.test.ts                       one test file per module or route
```

---

### Task 1: Scaffold the project and the health endpoint

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `wrangler.jsonc`, `.gitignore`, `.dev.vars.example`, `index.html`, `src/app/main.tsx`, `src/worker/index.ts`, `src/worker/app.ts`, `src/worker/env.ts`, `src/worker/http.ts`
- Test: `test/health.test.ts`

**Interfaces:**
- Produces:
  - `app` (Hono, base path `/api`) exported from `src/worker/app.ts`
  - types `Bindings`, `User`, `AppEnv` from `src/worker/env.ts`
  - `fail(c, status, error, message)` from `src/worker/http.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "campus-carbon",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "deploy": "npm run build && wrangler deploy",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.app.json && tsc -p tsconfig.worker.json",
    "cf-typegen": "wrangler types",
    "seed:sql": "node seed/build-sql.ts > seed/seed.sql",
    "db:local": "wrangler d1 migrations apply campus-carbon --local && npm run seed:sql && wrangler d1 execute campus-carbon --local --file seed/seed.sql"
  }
}
```

- [ ] **Step 2: Install dependencies**

```bash
npm install hono@^4 react@^19 react-dom@^19 qrcode@^1.5
npm install -D typescript@^5.9 vite@^8 @vitejs/plugin-react@^6 @cloudflare/vite-plugin@^1 wrangler@^4 vitest@^5 @types/react@^19 @types/react-dom@^19 @types/qrcode @types/node
```

Expected: both finish with no `ERESOLVE` errors. If one appears, stop and report it; do not use `--force`.

- [ ] **Step 3: Create the config files**

Type checking is split in two, because the Workers runtime types and the browser DOM types conflict when loaded together. Tests and seed scripts are run by Vitest and Node, not type-checked.

`tsconfig.app.json` (browser code):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vite/client"]
  },
  "include": ["src/app"]
}
```

`tsconfig.worker.json` (Worker code; `worker-configuration.d.ts` is generated in Step 7):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": []
  },
  "include": ["src/worker", "worker-configuration.d.ts"]
}
```

`tsconfig.json` (editor support for tests and seed; not used by `typecheck`):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["seed", "test"]
}
```

`vite.config.ts`:
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [react(), cloudflare()],
});
```

`vitest.config.ts` (a separate file, so tests don't load the Cloudflare plugin):
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/**/*.test.ts"], environment: "node" },
});
```

`wrangler.jsonc`:
```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "campus-carbon",
  "main": "./src/worker/index.ts",
  "compatibility_date": "2026-09-28",
  "assets": {
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "campus-carbon",
      "database_id": "00000000-0000-0000-0000-000000000000",
      "migrations_dir": "migrations"
    }
  ],
  "observability": { "enabled": true }
}
```
The all-zero `database_id` works for local development. Task 14 replaces it with the real id.

`.gitignore`:
```
node_modules
dist
.wrangler
.dev.vars
seed/seed.sql
```

`.dev.vars.example` (copy to `.dev.vars` for local dev):
```
TOKEN_SECRET=dev-token-secret-change-me
COOKIE_SECRET=dev-cookie-secret-change-me
```

Run: `cp .dev.vars.example .dev.vars`

`index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#F7F7F5" />
    <title>Campus Carbon</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/app/main.tsx"></script>
  </body>
</html>
```

`src/app/main.tsx` (placeholder; Task 11 replaces it):
```tsx
import { createRoot } from "react-dom/client";

createRoot(document.getElementById("root")!).render(<p>Campus Carbon</p>);
```

- [ ] **Step 4: Write the failing test** `test/health.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { app } from "../src/worker/app";

describe("GET /api/health", () => {
  it("returns ok", async () => {
    const res = await app.request("/api/health", {}, {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns a JSON 404 for unknown API paths", async () => {
    const res = await app.request("/api/nope", {}, {});
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found", message: "Not found." });
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npx vitest run test/health.test.ts`
Expected: FAIL, "Cannot find module '../src/worker/app'"

- [ ] **Step 6: Implement**

`src/worker/env.ts`:
```ts
export type Bindings = {
  DB: D1Database;
  TOKEN_SECRET: string;
  COOKIE_SECRET: string;
};

export type Role = "student" | "seller" | "admin";

export type User = {
  id: string;
  display_name: string;
  role: Role;
  stall_id: string | null;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: { user: User | null; adminId: string | null };
};
```

`src/worker/http.ts`:
```ts
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export function fail(c: Context, status: ContentfulStatusCode, error: string, message: string) {
  return c.json({ error, message }, status);
}
```

`src/worker/app.ts`:
```ts
import { Hono } from "hono";
import type { AppEnv } from "./env";

export const app = new Hono<AppEnv>().basePath("/api");

app.get("/health", (c) => c.json({ ok: true }));

app.notFound((c) => c.json({ error: "not_found", message: "Not found." }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "server_error", message: "Something went wrong. Please try again." }, 500);
});
```

`src/worker/index.ts`:
```ts
import { app } from "./app";

export default app;
```

- [ ] **Step 7: Generate the Worker types**

Run: `npm run cf-typegen`
Expected: creates `worker-configuration.d.ts`, which declares `D1Database` and friends.

- [ ] **Step 8: Run the tests, then build**

Run: `npx vitest run test/health.test.ts`
Expected: PASS (2 tests)

Run: `npm run build && npm run typecheck`
Expected: builds both the client and the Worker, and both type checks pass, with no errors.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold worker + react app with health endpoint"
```

---

### Task 2: Database schema and the test D1 adapter

**Files:**
- Create: `migrations/0001_init.sql`, `test/helpers/d1.ts`
- Test: `test/schema.test.ts`

**Interfaces:**
- Produces:
  - `createTestD1(): { d1: D1Database; raw: DatabaseSync }`. It applies every `migrations/*.sql` in name order.
  - the full schema from spec §6. Later stages add no tables for Stage 1 features.

- [ ] **Step 1: Write the failing test** `test/schema.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { createTestD1 } from "./helpers/d1";

describe("schema", () => {
  it("creates every table from the spec", () => {
    const { raw } = createTestD1();
    const names = raw
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: any) => r.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "activities", "badges", "factors", "items", "locations", "missions", "routes",
        "settings", "stalls", "summaries", "tokens", "user_badges", "user_missions", "users",
      ]),
    );
  });

  it("adapter supports bind/first/all/run/batch like D1", async () => {
    const { d1 } = createTestD1();
    await d1.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").bind("a", "1").run();
    const run = await d1.prepare("UPDATE settings SET value=? WHERE key=?").bind("2", "a").run();
    expect(run.meta.changes).toBe(1);
    expect(await d1.prepare("SELECT value FROM settings WHERE key=?").bind("a").first()).toEqual({ value: "2" });
    expect(await d1.prepare("SELECT value FROM settings WHERE key=?").bind("a").first("value")).toBe("2");
    expect(await d1.prepare("SELECT value FROM settings WHERE key=?").bind("zz").first()).toBeNull();
    await d1.batch([
      d1.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").bind("b", "1"),
      d1.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").bind("c", "1"),
    ]);
    const all = await d1.prepare("SELECT key FROM settings ORDER BY key").all();
    expect(all.results.map((r: any) => r.key)).toEqual(["a", "b", "c"]);
  });

  it("batch rolls back entirely on failure", async () => {
    const { d1 } = createTestD1();
    await expect(
      d1.batch([
        d1.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").bind("x", "1"),
        d1.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").bind("x", "dup"),
      ]),
    ).rejects.toThrow();
    expect(await d1.prepare("SELECT COUNT(*) AS n FROM settings").first("n")).toBe(0);
  });

  it("rejects duplicate image_hash on activities", () => {
    const { raw } = createTestD1();
    raw.exec("INSERT INTO users (id, display_name, role, created_at) VALUES ('u','U','student',0)");
    const ins = "INSERT INTO activities (id,user_id,category,type,points,verified,source,image_hash,created_at) VALUES (?, 'u','food','meal',0,0,'photo','h',0)";
    raw.prepare(ins).run("a1");
    expect(() => raw.prepare(ins).run("a2")).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/schema.test.ts`
Expected: FAIL, "Cannot find module './helpers/d1'"

- [ ] **Step 3: Write `migrations/0001_init.sql`**

```sql
CREATE TABLE stalls (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  canteen TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  verify_method TEXT NOT NULL DEFAULT 'qr' CHECK (verify_method IN ('qr','nfc','both'))
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student','seller','admin')),
  stall_id TEXT REFERENCES stalls(id),
  email TEXT,
  email_verified_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE items (
  id TEXT PRIMARY KEY,
  stall_id TEXT NOT NULL REFERENCES stalls(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('meal','drink')),
  parts_json TEXT NOT NULL DEFAULT '{}',
  kg_co2e REAL,
  low_carbon INTEGER NOT NULL DEFAULT 0,
  points INTEGER,               -- NULL = use settings
  status TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('draft','live'))
);

CREATE TABLE tokens (
  id TEXT PRIMARY KEY,
  stall_id TEXT NOT NULL REFERENCES stalls(id),
  item_id TEXT NOT NULL REFERENCES items(id),
  byo INTEGER NOT NULL DEFAULT 0,
  method TEXT NOT NULL DEFAULT 'qr' CHECK (method IN ('qr','nfc')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  pending_user_id TEXT REFERENCES users(id),
  confirmed_at INTEGER,
  used_at INTEGER,
  used_by TEXT REFERENCES users(id)
);

CREATE TABLE activities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  category TEXT NOT NULL CHECK (category IN ('food','mobility','waste')),
  type TEXT NOT NULL CHECK (type IN ('meal','drink','byo','trip','steps','container_return')),
  kg_co2e REAL,
  points INTEGER NOT NULL DEFAULT 0,
  verified INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('qr','nfc','manual','photo')),
  token_id TEXT REFERENCES tokens(id),
  stall_id TEXT REFERENCES stalls(id),
  item_id TEXT REFERENCES items(id),
  low_carbon INTEGER,
  image_hash TEXT UNIQUE,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_activities_user_time ON activities (user_id, created_at);
CREATE INDEX idx_activities_stall_time ON activities (stall_id, created_at);

CREATE TABLE factors (
  key TEXT PRIMARY KEY,
  kg_per_unit REAL,             -- NULL = pending
  unit TEXT NOT NULL CHECK (unit IN ('kg','pkm')),
  source TEXT NOT NULL,
  note TEXT
);

CREATE TABLE locations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE routes (
  from_id TEXT NOT NULL REFERENCES locations(id),
  to_id TEXT NOT NULL REFERENCES locations(id),
  distance_km REAL NOT NULL,
  walk_min REAL NOT NULL,
  shuttle_min REAL,
  placeholder INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (from_id, to_id)
);

CREATE TABLE missions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  metric TEXT NOT NULL,
  target REAL NOT NULL,
  points INTEGER NOT NULL,
  period TEXT NOT NULL CHECK (period IN ('daily','weekly'))
);

CREATE TABLE user_missions (
  user_id TEXT NOT NULL REFERENCES users(id),
  mission_id TEXT NOT NULL REFERENCES missions(id),
  period_start INTEGER NOT NULL,
  progress REAL NOT NULL DEFAULT 0,
  completed_at INTEGER,
  PRIMARY KEY (user_id, mission_id, period_start)
);

CREATE TABLE badges (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  rule TEXT NOT NULL
);

CREATE TABLE user_badges (
  user_id TEXT NOT NULL REFERENCES users(id),
  badge_id TEXT NOT NULL REFERENCES badges(id),
  earned_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, badge_id)
);

CREATE TABLE summaries (
  user_id TEXT NOT NULL REFERENCES users(id),
  week_start INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, week_start)
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

Note: `missions.metric` (e.g. `low_carbon_meals`, `steps`) is an addition to spec §6, so that Stage 2 can evaluate missions generically.

- [ ] **Step 4: Write `test/helpers/d1.ts`**

```ts
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";

type Row = Record<string, unknown>;

function plain(row: unknown): Row | null {
  return row == null ? null : { ...(row as Row) };
}

function statement(db: DatabaseSync, sql: string, params: unknown[] = []): any {
  return {
    bind: (...p: unknown[]) => statement(db, sql, p),
    first: async (col?: string) => {
      const row = plain(db.prepare(sql).get(...(params as any[])));
      if (row && col) return row[col];
      return row;
    },
    all: async () => ({
      results: db.prepare(sql).all(...(params as any[])).map((r) => plain(r)!),
      success: true,
      meta: {},
    }),
    run: async () => {
      const r = db.prepare(sql).run(...(params as any[]));
      return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    },
  };
}

export function wrapD1(db: DatabaseSync): any {
  return {
    prepare: (sql: string) => statement(db, sql),
    batch: async (stmts: any[]) => {
      db.exec("BEGIN");
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    exec: async (sql: string) => {
      db.exec(sql);
      return { count: 0, duration: 0 };
    },
  };
}

export function createTestD1() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON");
  const files = readdirSync("migrations").filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) raw.exec(readFileSync(`migrations/${f}`, "utf8"));
  return { d1: wrapD1(raw), raw };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/schema.test.ts`
Expected: PASS (4 tests). An `ExperimentalWarning` about SQLite is fine.

- [ ] **Step 6: Commit**

```bash
git add migrations test/helpers/d1.ts test/schema.test.ts
git commit -m "feat(db): initial D1 schema and node:sqlite test adapter"
```

---

### Task 3: Carbon module

**Files:**
- Create: `src/worker/lib/carbon.ts`
- Test: `test/carbon.test.ts`

**Interfaces:**
- Produces:
  - `type Parts = Record<string, number>` (grams)
  - `type FactorTable = Record<string, number | null>` (kg CO2e per kg)
  - `computeKg(parts: Parts, factors: FactorTable): number | null`
  - `isLowCarbonMeal(parts: Parts): boolean`
  - `HIGH_CARBON_PROTEINS: readonly string[]`

- [ ] **Step 1: Write the failing test** `test/carbon.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { computeKg, isLowCarbonMeal } from "../src/worker/lib/carbon";

const F = {
  rice: 4.45, wheat: 1.57, poultry: 9.87, pork: 12.31, beef_herd: 99.48, beef_dairy: 33.3,
  fish_farmed: 13.63, eggs: 4.67, tofu: 3.16, milk: 3.15, coffee: 28.53, cane_sugar: 3.2, veg: 0.43,
};

describe("computeKg reproduces every spec seed value (spec §14.2–14.3)", () => {
  it.each([
    ["econ-veg-egg", { rice: 80, veg: 150, eggs: 50 }, 0.65],
    ["econ-veg-tofu", { rice: 80, veg: 150, tofu: 80 }, 0.67],
    ["veg-noodles", { wheat: 100, veg: 100, tofu: 60 }, 0.39],
    ["wanton-mee", { wheat: 100, pork: 60, veg: 30 }, 0.91],
    ["econ-chicken", { rice: 80, poultry: 80, veg: 75 }, 1.18],
    ["chicken-rice", { rice: 80, poultry: 100, veg: 30 }, 1.36],
    ["econ-pork", { rice: 80, pork: 80, veg: 75 }, 1.37],
    ["econ-fish", { rice: 80, fish_farmed: 80, veg: 75 }, 1.48],
    ["fish-soup", { rice: 80, fish_farmed: 120, veg: 80 }, 2.03],
    ["beef-hor-fun low end", { rice: 80, beef_dairy: 80, veg: 30 }, 3.03],
    ["beef-hor-fun high end", { rice: 80, beef_herd: 80, veg: 30 }, 8.33],
    ["kopi", { coffee: 10, milk: 50, cane_sugar: 10 }, 0.47],
    ["kopi-o-kosong", { coffee: 10 }, 0.29],
    ["teh", { milk: 50, cane_sugar: 10 }, 0.19],
  ])("%s", (_id, parts, kg) => {
    expect(computeKg(parts, F)).toBe(kg);
  });

  it("returns null for empty parts (not estimable)", () => {
    expect(computeKg({}, F)).toBeNull();
  });

  it("returns null when any ingredient has no factor", () => {
    expect(computeKg({ rice: 80, tea_leaves: 5 }, F)).toBeNull();
    expect(computeKg({ rice: 80 }, { rice: null })).toBeNull();
  });
});

describe("isLowCarbonMeal (spec §7)", () => {
  it("is true for plant or egg protein", () => {
    expect(isLowCarbonMeal({ rice: 80, veg: 150, eggs: 50 })).toBe(true);
    expect(isLowCarbonMeal({ wheat: 100, veg: 100, tofu: 60 })).toBe(true);
  });
  it.each(["poultry", "pork", "beef_herd", "beef_dairy", "fish_farmed"])("is false with %s", (k) => {
    expect(isLowCarbonMeal({ rice: 80, [k]: 50 })).toBe(false);
  });
  it("ignores a zero-gram protein entry", () => {
    expect(isLowCarbonMeal({ rice: 80, pork: 0 })).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/carbon.test.ts`
Expected: FAIL, "Cannot find module '../src/worker/lib/carbon'"

- [ ] **Step 3: Implement** `src/worker/lib/carbon.ts`

```ts
export type Parts = Record<string, number>;
export type FactorTable = Record<string, number | null>;

export const HIGH_CARBON_PROTEINS: readonly string[] = [
  "poultry", "pork", "beef_herd", "beef_dairy", "fish_farmed",
];

/** kg CO2e for ingredient grams, rounded to 2 dp. null = not estimable. */
export function computeKg(parts: Parts, factors: FactorTable): number | null {
  const keys = Object.keys(parts);
  if (keys.length === 0) return null;
  let total = 0;
  for (const k of keys) {
    const f = factors[k];
    if (f == null) return null;
    total += (parts[k] / 1000) * f;
  }
  return Math.round(total * 100) / 100;
}

/** Low-carbon = no meat, fish or seafood protein (spec §7). */
export function isLowCarbonMeal(parts: Parts): boolean {
  return !Object.keys(parts).some((k) => HIGH_CARBON_PROTEINS.includes(k) && parts[k] > 0);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/carbon.test.ts`
Expected: PASS (22 tests)

- [ ] **Step 5: Commit**

```bash
git add src/worker/lib/carbon.ts test/carbon.test.ts
git commit -m "feat(carbon): ingredient-based kg CO2e and low-carbon rule"
```

---

### Task 4: HMAC token signing

**Files:**
- Create: `src/worker/lib/token.ts`
- Test: `test/token.test.ts`

**Interfaces:**
- Produces:
  - `sign(value: string, secret: string): Promise<string>`, which returns `"<value>.<base64url sig>"`
  - `verify(signed: unknown, secret: string): Promise<string | null>`, which returns the value or null
- Used for both claim tokens (`TOKEN_SECRET`) and session cookies (`COOKIE_SECRET`).

- [ ] **Step 1: Write the failing test** `test/token.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { sign, verify } from "../src/worker/lib/token";

describe("token sign/verify", () => {
  it("round-trips a value", async () => {
    const s = await sign("abc-123", "k");
    expect(s.startsWith("abc-123.")).toBe(true);
    expect(await verify(s, "k")).toBe("abc-123");
  });

  it("uses only URL-safe characters", async () => {
    const s = await sign("x", "k");
    expect(s).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it("rejects the wrong secret", async () => {
    expect(await verify(await sign("abc", "k1"), "k2")).toBeNull();
  });

  it("rejects a changed value or signature", async () => {
    const s = await sign("abc", "k");
    const [v, sig] = s.split(".");
    expect(await verify(`abd.${sig}`, "k")).toBeNull();
    expect(await verify(`${v}.${sig.slice(0, -2)}AA`, "k")).toBeNull();
  });

  it.each([["", ], ["garbage"], ["."], ["abc."], [".sig"], ["abc.!!!"]])("rejects malformed %j", async (bad) => {
    expect(await verify(bad, "k")).toBeNull();
  });

  it.each([[undefined], [null], [123], [{}]])("rejects non-string %j", async (bad) => {
    expect(await verify(bad, "k")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/token.test.ts`
Expected: FAIL, "Cannot find module"

- [ ] **Step 3: Implement** `src/worker/lib/token.ts`

```ts
const enc = new TextEncoder();

function hmacKey(secret: string) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

function toB64url(buf: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  try {
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export async function sign(value: string, secret: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(value));
  return `${value}.${toB64url(sig)}`;
}

export async function verify(signed: unknown, secret: string): Promise<string | null> {
  if (typeof signed !== "string") return null;
  const i = signed.lastIndexOf(".");
  if (i <= 0 || i === signed.length - 1) return null;
  const value = signed.slice(0, i);
  const sig = fromB64url(signed.slice(i + 1));
  if (!sig) return null;
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), sig, enc.encode(value));
  return ok ? value : null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/token.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/worker/lib/token.ts test/token.test.ts
git commit -m "feat(token): HMAC-SHA256 sign/verify with base64url"
```

---

### Task 5: Time, settings and scoring modules

**Files:**
- Create: `src/worker/lib/time.ts`, `src/worker/lib/settings.ts`, `src/worker/lib/scoring.ts`
- Test: `test/time.test.ts`, `test/scoring.test.ts`

**Interfaces:**
- Produces:
  - `sgDayStart(ms: number): number`: epoch ms of 00:00 Asia/Singapore on that day
  - `sgWeekStart(ms: number): number`: epoch ms of Monday 00:00 Asia/Singapore
  - `DEFAULT_SETTINGS`, `type Settings`, `parseSettings(rows: {key: string; value: string}[]): Settings`
  - `stallClaimPoints(item: { kind: "meal" | "drink"; low_carbon: boolean; points: number | null }, s: Settings): number`
  - `byoPoints(s: Settings): number`

- [ ] **Step 1: Write the failing tests**

`test/time.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { sgDayStart, sgWeekStart } from "../src/worker/lib/time";

// SGT = UTC+8. 2026-09-28 is a Monday.
const MON_0000_SGT = Date.UTC(2026, 8, 27, 16, 0);

describe("sgDayStart", () => {
  it("maps late-evening UTC to the next SG day", () => {
    expect(sgDayStart(Date.UTC(2026, 8, 27, 16, 0))).toBe(MON_0000_SGT); // Mon 00:00 SGT
    expect(sgDayStart(Date.UTC(2026, 8, 28, 15, 59))).toBe(MON_0000_SGT); // Mon 23:59 SGT
    expect(sgDayStart(Date.UTC(2026, 8, 27, 15, 59))).toBe(MON_0000_SGT - 86_400_000); // Sun 23:59 SGT
  });
});

describe("sgWeekStart", () => {
  it("returns Monday 00:00 SGT", () => {
    expect(sgWeekStart(Date.UTC(2026, 8, 29, 4, 0))).toBe(MON_0000_SGT); // Tue noon SGT
    expect(sgWeekStart(MON_0000_SGT)).toBe(MON_0000_SGT);
    expect(sgWeekStart(Date.UTC(2026, 9, 4, 15, 59))).toBe(MON_0000_SGT); // Sun 23:59 SGT
  });
  it("Sunday night belongs to the previous week", () => {
    expect(sgWeekStart(MON_0000_SGT - 60_000)).toBe(MON_0000_SGT - 7 * 86_400_000);
  });
});
```

`test/scoring.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, parseSettings } from "../src/worker/lib/settings";
import { byoPoints, stallClaimPoints } from "../src/worker/lib/scoring";

const s = DEFAULT_SETTINGS;

describe("stallClaimPoints (spec §7)", () => {
  it("low-carbon meal earns points_meal_low_carbon", () => {
    expect(stallClaimPoints({ kind: "meal", low_carbon: true, points: null }, s)).toBe(20);
  });
  it("other meal earns 0", () => {
    expect(stallClaimPoints({ kind: "meal", low_carbon: false, points: null }, s)).toBe(0);
  });
  it("drink earns 0 even if flagged low-carbon", () => {
    expect(stallClaimPoints({ kind: "drink", low_carbon: true, points: null }, s)).toBe(0);
  });
  it("item points override wins", () => {
    expect(stallClaimPoints({ kind: "meal", low_carbon: false, points: 7 }, s)).toBe(7);
  });
  it("uses changed settings", () => {
    expect(stallClaimPoints({ kind: "meal", low_carbon: true, points: null }, { ...s, points_meal_low_carbon: 25 })).toBe(25);
  });
});

describe("byoPoints", () => {
  it("is points_byo", () => expect(byoPoints(s)).toBe(15));
});

describe("parseSettings", () => {
  it("overrides defaults with numeric values and ignores junk", () => {
    const out = parseSettings([
      { key: "points_byo", value: "12" },
      { key: "token_ttl_sec", value: "not a number" },
      { key: "unknown_key", value: "5" },
    ]);
    expect(out.points_byo).toBe(12);
    expect(out.token_ttl_sec).toBe(90);
    expect((out as any).unknown_key).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/time.test.ts test/scoring.test.ts`
Expected: FAIL, "Cannot find module"

- [ ] **Step 3: Implement**

`src/worker/lib/time.ts`:
```ts
const DAY = 86_400_000;
const SG_OFFSET = 8 * 3_600_000; // Asia/Singapore, no DST

export function sgDayStart(ms: number): number {
  return Math.floor((ms + SG_OFFSET) / DAY) * DAY - SG_OFFSET;
}

export function sgWeekStart(ms: number): number {
  const day = sgDayStart(ms);
  const weekday = new Date(day + SG_OFFSET).getUTCDay(); // 0 = Sunday
  const sinceMonday = (weekday + 6) % 7;
  return day - sinceMonday * DAY;
}
```

`src/worker/lib/settings.ts`:
```ts
export const DEFAULT_SETTINGS = {
  points_meal_low_carbon: 20,
  points_byo: 15,
  points_photo_low_carbon: 5,
  points_walk_trip: 10,
  points_shuttle_trip: 5,
  points_container_return: 5,
  self_reported_daily_cap: 30,
  rate_stall_window_min: 10,
  rate_daily_max: 5,
  token_ttl_sec: 90,
};

export type Settings = { [K in keyof typeof DEFAULT_SETTINGS]: number };

export function parseSettings(rows: { key: string; value: string }[]): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  for (const { key, value } of rows) {
    if (!(key in out)) continue;
    const n = Number(value);
    if (Number.isFinite(n)) out[key as keyof Settings] = n;
  }
  return out;
}
```

`src/worker/lib/scoring.ts`:
```ts
import type { Settings } from "./settings";

export function stallClaimPoints(
  item: { kind: "meal" | "drink"; low_carbon: boolean; points: number | null },
  s: Settings,
): number {
  if (item.points != null) return item.points;
  return item.kind === "meal" && item.low_carbon ? s.points_meal_low_carbon : 0;
}

export function byoPoints(s: Settings): number {
  return s.points_byo;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/time.test.ts test/scoring.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/worker/lib/time.ts src/worker/lib/settings.ts src/worker/lib/scoring.ts test/time.test.ts test/scoring.test.ts
git commit -m "feat(lib): SG time boundaries, settings defaults, stall claim scoring"
```

---

### Task 6: Seed data and SQL builder

**Files:**
- Create: `seed/data.ts`, `seed/sql.ts`, `seed/build-sql.ts`, `test/helpers/setup.ts` (seed part only; Task 7 adds the request client)
- Test: `test/seed.test.ts`

**Interfaces:**
- Consumes: `computeKg`, `isLowCarbonMeal` (Task 3); `DEFAULT_SETTINGS` (Task 5)
- Produces:
  - `buildSeedSql(now?: number): string`: idempotent `INSERT OR REPLACE` statements
  - seeded ids that later tasks and tests rely on:
    - stalls: `econ-rice` (qr), `noodles` (both), `drinks` (qr)
    - users: `u-admin` (admin), `u-seller-econ` → `econ-rice`, `u-seller-noodles` → `noodles`, `u-seller-drinks` → `drinks`, students `u-alex`, `u-bea`, `u-chen`
    - items: the spec §14.2–14.3 ids (`econ-veg-egg`, …, `beef-hor-fun`, `kopi`, `kopi-o-kosong`, `teh`, `teh-o-kosong`)

- [ ] **Step 1: Write `seed/data.ts`**

```ts
import { DEFAULT_SETTINGS } from "../src/worker/lib/settings.ts";

const OWID = "Poore & Nemecek (2018) via Our World in Data";

export const FACTORS: { key: string; kg_per_unit: number | null; unit: "kg" | "pkm"; source: string; note: string | null }[] = [
  { key: "rice", kg_per_unit: 4.45, unit: "kg", source: OWID, note: null },
  { key: "wheat", kg_per_unit: 1.57, unit: "kg", source: OWID, note: null },
  { key: "poultry", kg_per_unit: 9.87, unit: "kg", source: OWID, note: null },
  { key: "pork", kg_per_unit: 12.31, unit: "kg", source: OWID, note: null },
  { key: "beef_herd", kg_per_unit: 99.48, unit: "kg", source: OWID, note: null },
  { key: "beef_dairy", kg_per_unit: 33.3, unit: "kg", source: OWID, note: "TODO confirm on OWID grapher" },
  { key: "fish_farmed", kg_per_unit: 13.63, unit: "kg", source: OWID, note: "TODO confirm on OWID grapher" },
  { key: "eggs", kg_per_unit: 4.67, unit: "kg", source: OWID, note: null },
  { key: "tofu", kg_per_unit: 3.16, unit: "kg", source: OWID, note: null },
  { key: "milk", kg_per_unit: 3.15, unit: "kg", source: OWID, note: "proxy for condensed/evaporated milk in kopi" },
  { key: "coffee", kg_per_unit: 28.53, unit: "kg", source: OWID, note: "TODO confirm on OWID grapher" },
  { key: "cane_sugar", kg_per_unit: 3.2, unit: "kg", source: OWID, note: null },
  { key: "veg", kg_per_unit: 0.43, unit: "kg", source: OWID, note: "root vegetables, proxy for all vegetables" },
  { key: "shuttle", kg_per_unit: null, unit: "pkm", source: "pending", note: "find sourced per-passenger-km factor; check if NTU shuttle is electric" },
  { key: "car", kg_per_unit: null, unit: "pkm", source: "pending", note: "find sourced per-passenger-km factor" },
];

export const STALLS = [
  { id: "econ-rice", name: "Economy Rice", canteen: "Demo Canteen", verify_method: "qr" },
  { id: "noodles", name: "Noodles & Rice Plates", canteen: "Demo Canteen", verify_method: "both" },
  { id: "drinks", name: "Drinks", canteen: "Demo Canteen", verify_method: "qr" },
] as const;

export type SeedItem = {
  id: string;
  stall_id: string;
  name: string;
  kind: "meal" | "drink";
  parts: Record<string, number>;
  kg_override?: number;
};

export const ITEMS: SeedItem[] = [
  { id: "econ-veg-egg", stall_id: "econ-rice", name: "Economy rice: 2 veg + egg", kind: "meal", parts: { rice: 80, veg: 150, eggs: 50 } },
  { id: "econ-veg-tofu", stall_id: "econ-rice", name: "Economy rice: 2 veg + tofu", kind: "meal", parts: { rice: 80, veg: 150, tofu: 80 } },
  { id: "econ-chicken", stall_id: "econ-rice", name: "Economy rice: 1 chicken + 1 veg", kind: "meal", parts: { rice: 80, poultry: 80, veg: 75 } },
  { id: "econ-pork", stall_id: "econ-rice", name: "Economy rice: 1 pork + 1 veg", kind: "meal", parts: { rice: 80, pork: 80, veg: 75 } },
  { id: "econ-fish", stall_id: "econ-rice", name: "Economy rice: 1 fish + 1 veg", kind: "meal", parts: { rice: 80, fish_farmed: 80, veg: 75 } },
  { id: "veg-noodles", stall_id: "noodles", name: "Vegetarian noodles with tofu", kind: "meal", parts: { wheat: 100, veg: 100, tofu: 60 } },
  { id: "wanton-mee", stall_id: "noodles", name: "Wanton / char siew noodles", kind: "meal", parts: { wheat: 100, pork: 60, veg: 30 } },
  { id: "chicken-rice", stall_id: "noodles", name: "Chicken rice", kind: "meal", parts: { rice: 80, poultry: 100, veg: 30 } },
  { id: "fish-soup", stall_id: "noodles", name: "Fish soup with rice", kind: "meal", parts: { rice: 80, fish_farmed: 120, veg: 80 } },
  { id: "beef-hor-fun", stall_id: "noodles", name: "Beef hor fun", kind: "meal", parts: { rice: 80, beef_dairy: 80, veg: 30 }, kg_override: 5.7 },
  { id: "kopi", stall_id: "drinks", name: "Kopi (with milk, sugar)", kind: "drink", parts: { coffee: 10, milk: 50, cane_sugar: 10 } },
  { id: "kopi-o-kosong", stall_id: "drinks", name: "Kopi-O kosong", kind: "drink", parts: { coffee: 10 } },
  { id: "teh", stall_id: "drinks", name: "Teh (with milk, sugar)", kind: "drink", parts: { milk: 50, cane_sugar: 10 } },
  { id: "teh-o-kosong", stall_id: "drinks", name: "Teh-O kosong", kind: "drink", parts: {} },
];

export const USERS = [
  { id: "u-admin", display_name: "Admin", role: "admin", stall_id: null },
  { id: "u-seller-econ", display_name: "Economy Rice seller", role: "seller", stall_id: "econ-rice" },
  { id: "u-seller-noodles", display_name: "Noodles seller", role: "seller", stall_id: "noodles" },
  { id: "u-seller-drinks", display_name: "Drinks seller", role: "seller", stall_id: "drinks" },
  { id: "u-alex", display_name: "Alex", role: "student", stall_id: null },
  { id: "u-bea", display_name: "Bea", role: "student", stall_id: null },
  { id: "u-chen", display_name: "Chen", role: "student", stall_id: null },
] as const;

export const SETTINGS = DEFAULT_SETTINGS;
```

- [ ] **Step 2: Write the failing test** `test/seed.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { createTestD1 } from "./helpers/d1";
import { buildSeedSql } from "../seed/sql";

function seeded() {
  const t = createTestD1();
  t.raw.exec(buildSeedSql(Date.UTC(2026, 8, 1)));
  return t;
}

describe("seed", () => {
  it("applies cleanly and is idempotent", () => {
    const { raw } = seeded();
    raw.exec(buildSeedSql(Date.UTC(2026, 8, 1)));
    expect((raw.prepare("SELECT COUNT(*) AS n FROM items").get() as any).n).toBe(14);
    expect((raw.prepare("SELECT COUNT(*) AS n FROM users").get() as any).n).toBe(7);
    expect((raw.prepare("SELECT COUNT(*) AS n FROM stalls").get() as any).n).toBe(3);
  });

  it("stores computed kg and low-carbon flags", () => {
    const { raw } = seeded();
    const row = (id: string) => raw.prepare("SELECT kg_co2e, low_carbon, kind FROM items WHERE id=?").get(id) as any;
    expect(row("econ-veg-egg")).toEqual({ kg_co2e: 0.65, low_carbon: 1, kind: "meal" });
    expect(row("chicken-rice")).toEqual({ kg_co2e: 1.36, low_carbon: 0, kind: "meal" });
    expect(row("beef-hor-fun")).toEqual({ kg_co2e: 5.7, low_carbon: 0, kind: "meal" });
    expect(row("kopi")).toEqual({ kg_co2e: 0.47, low_carbon: 0, kind: "drink" });
    expect(row("teh-o-kosong")).toEqual({ kg_co2e: null, low_carbon: 0, kind: "drink" });
  });

  it("seeds mobility factors as pending (null)", () => {
    const { raw } = seeded();
    const f = raw.prepare("SELECT kg_per_unit FROM factors WHERE key IN ('shuttle','car')").all() as any[];
    expect(f.map((r) => r.kg_per_unit)).toEqual([null, null]);
  });

  it("links sellers to stalls and back-dates accounts 14 days", () => {
    const { raw } = seeded();
    const u = raw.prepare("SELECT stall_id, created_at FROM users WHERE id='u-seller-econ'").get() as any;
    expect(u.stall_id).toBe("econ-rice");
    expect(u.created_at).toBe(Date.UTC(2026, 8, 1) - 14 * 86_400_000);
  });

  it("escapes single quotes in text", () => {
    const { raw } = seeded();
    raw.exec(buildSeedSql().replaceAll("'Demo Canteen'", "'Demo''s Canteen'"));
    expect((raw.prepare("SELECT canteen FROM stalls WHERE id='drinks'").get() as any).canteen).toBe("Demo's Canteen");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run test/seed.test.ts`
Expected: FAIL, "Cannot find module '../seed/sql'"

- [ ] **Step 4: Implement**

`seed/sql.ts`:
```ts
import { computeKg, isLowCarbonMeal, type FactorTable } from "../src/worker/lib/carbon.ts";
import { FACTORS, ITEMS, SETTINGS, STALLS, USERS } from "./data.ts";

type Val = string | number | null;

function lit(v: Val): string {
  if (v === null) return "NULL";
  if (typeof v === "number") return String(v);
  return `'${v.replace(/'/g, "''")}'`;
}

function upsert(table: string, row: Record<string, Val>): string {
  const cols = Object.keys(row);
  return `INSERT OR REPLACE INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((c) => lit(row[c])).join(", ")});`;
}

export function buildSeedSql(now: number = Date.now()): string {
  const factorTable: FactorTable = Object.fromEntries(
    FACTORS.filter((f) => f.unit === "kg").map((f) => [f.key, f.kg_per_unit]),
  );
  const created = now - 14 * 86_400_000;
  const out: string[] = [];

  for (const f of FACTORS) out.push(upsert("factors", { ...f }));
  for (const s of STALLS) out.push(upsert("stalls", { ...s, active: 1 }));
  for (const u of USERS) out.push(upsert("users", { ...u, created_at: created }));
  for (const i of ITEMS) {
    const kg = i.kg_override ?? computeKg(i.parts, factorTable);
    const low = i.kind === "meal" && isLowCarbonMeal(i.parts) ? 1 : 0;
    out.push(
      upsert("items", {
        id: i.id,
        stall_id: i.stall_id,
        name: i.name,
        kind: i.kind,
        parts_json: JSON.stringify(i.parts),
        kg_co2e: kg,
        low_carbon: low,
        points: null,
        status: "live",
      }),
    );
  }
  for (const [key, value] of Object.entries(SETTINGS)) out.push(upsert("settings", { key, value: String(value) }));

  return out.join("\n") + "\n";
}
```

`seed/build-sql.ts`:
```ts
import { buildSeedSql } from "./sql.ts";

process.stdout.write(buildSeedSql());
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/seed.test.ts`
Expected: PASS

Run: `npm run seed:sql && head -3 seed/seed.sql`
Expected: three `INSERT OR REPLACE INTO factors …` lines.

- [ ] **Step 6: Commit**

```bash
git add seed test/seed.test.ts
git commit -m "feat(seed): factors, stalls, items, personas, settings"
```

---

### Task 7: Sessions, onboarding and the admin persona switcher

**Files:**
- Create: `src/worker/session.ts`, `src/worker/db.ts`, `src/worker/routes/auth.ts`, `test/helpers/setup.ts`
- Modify: `src/worker/app.ts` (register the middleware and routes)
- Test: `test/auth.test.ts`

**Interfaces:**
- Consumes: `sign`, `verify` (Task 4); `parseSettings` (Task 5); `buildSeedSql` (Task 6); `createTestD1` (Task 2)
- Produces:
  - `session` middleware, which sets `c.get("user")` and `c.get("adminId")`
  - `startSession(c, userId)`
  - `requireRole(...roles)`: 401 `no_session` or 403 `forbidden`
  - `requireSwitcher`: 403 `forbidden` unless `adminId` is set
  - `loadSettings(db): Promise<Settings>`
  - test helper `setup()` returning `{ env, raw, req }`, where `req(path, { method?, body?, as?, cookie? })` → `{ status, body, headers }`. `as` signs a session cookie for that user id.
  - API:
    - `POST /api/session {display_name}` → 201 `{user}`
    - `GET /api/me` → `{user, can_switch}`
    - `GET /api/admin/users` → `{users}`
    - `POST /api/admin/impersonate {user_id}` → `{user}`

- [ ] **Step 1: Write the test helper** `test/helpers/setup.ts`

```ts
import { app } from "../../src/worker/app";
import { sign } from "../../src/worker/lib/token";
import { buildSeedSql } from "../../seed/sql";
import { createTestD1 } from "./d1";

export async function setup() {
  const { d1, raw } = createTestD1();
  raw.exec(buildSeedSql());
  const env = { DB: d1, TOKEN_SECRET: "test-token-secret", COOKIE_SECRET: "test-cookie-secret" };

  async function req(
    path: string,
    opts: { method?: string; body?: unknown; as?: string; cookie?: string } = {},
  ) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const cookies: string[] = [];
    if (opts.as) cookies.push(`uid=${encodeURIComponent(await sign(opts.as, env.COOKIE_SECRET))}`);
    if (opts.cookie) cookies.push(opts.cookie);
    if (cookies.length) headers.cookie = cookies.join("; ");
    const res = await app.request(
      `https://app.test${path}`,
      {
        method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      },
      env,
    );
    return { status: res.status, body: (await res.json().catch(() => null)) as any, headers: res.headers };
  }

  return { env, raw, req };
}

/** Turn Set-Cookie headers into a Cookie request header value. */
export function cookiesFrom(headers: Headers): string {
  return headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}
```

- [ ] **Step 2: Write the failing test** `test/auth.test.ts`

```ts
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run test/auth.test.ts`
Expected: FAIL (404s, because the routes don't exist yet)

- [ ] **Step 4: Implement**

`src/worker/db.ts`:
```ts
import { parseSettings, type Settings } from "./lib/settings";

export async function loadSettings(db: D1Database): Promise<Settings> {
  const { results } = await db.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  return parseSettings(results);
}
```

`src/worker/session.ts`:
```ts
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
```

`src/worker/routes/auth.ts`:
```ts
import { Hono } from "hono";
import type { AppEnv, User } from "../env";
import { fail } from "../http";
import { rememberAdmin, requireSwitcher, startSession } from "../session";

export const auth = new Hono<AppEnv>();

auth.post("/session", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { display_name?: unknown };
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
  const body = (await c.req.json().catch(() => ({}))) as { user_id?: unknown };
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
```

Modify `src/worker/app.ts`: add the middleware and mount the routes before the `notFound` / `onError` handlers.
```ts
import { Hono } from "hono";
import type { AppEnv } from "./env";
import { session } from "./session";
import { auth } from "./routes/auth";

export const app = new Hono<AppEnv>().basePath("/api");

app.get("/health", (c) => c.json({ ok: true }));
app.use("*", session);
app.route("/", auth);

app.notFound((c) => c.json({ error: "not_found", message: "Not found." }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "server_error", message: "Something went wrong. Please try again." }, 500);
});
```

Note: `/health` is registered before `session`, so the health check needs no DB (Task 1's test passes `{}` as env).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run`
Expected: all test files PASS, including the Task 1 health test.

- [ ] **Step 6: Commit**

```bash
git add src/worker test/helpers/setup.ts test/auth.test.ts
git commit -m "feat(auth): cookie sessions, onboarding, admin persona switcher"
```

---

### Task 8: Seller stall routes

**Files:**
- Create: `src/worker/routes/stall.ts`
- Modify: `src/worker/app.ts` (add `app.route("/", stall)` after `auth`)
- Test: `test/stall.test.ts`

**Interfaces:**
- Consumes: `requireRole` (Task 7); `loadSettings` (Task 7); `sign` (Task 4)
- Produces:
  - `GET /api/stall` → `{ stall: {id, name, canteen, active, verify_method}, items: {id, name, kind, kg_co2e, low_carbon: boolean}[] }`
  - `POST /api/stall/tokens {item_id, byo}` → 201 `{ id, token, claim_url, expires_at }`
  - `GET /api/stall/tokens/:id` → `{ state: "pending"|"claimed"|"expired", expires_at, claimed_by: string|null }`

- [ ] **Step 1: Write the failing test** `test/stall.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { setup } from "./helpers/setup";

describe("GET /api/stall", () => {
  it("returns the seller's stall and live items", async () => {
    const { req } = await setup();
    const res = await req("/api/stall", { as: "u-seller-econ" });
    expect(res.status).toBe(200);
    expect(res.body.stall.id).toBe("econ-rice");
    expect(res.body.items).toHaveLength(5);
    expect(res.body.items.find((i: any) => i.id === "econ-veg-egg")).toMatchObject({ low_carbon: true, kg_co2e: 0.65 });
  });

  it("hides draft items", async () => {
    const { req, raw } = await setup();
    raw.exec("UPDATE items SET status='draft' WHERE id='econ-pork'");
    const res = await req("/api/stall", { as: "u-seller-econ" });
    expect(res.body.items.map((i: any) => i.id)).not.toContain("econ-pork");
  });

  it("is seller-only", async () => {
    const { req } = await setup();
    expect((await req("/api/stall")).status).toBe(401);
    expect((await req("/api/stall", { as: "u-alex" })).status).toBe(403);
  });
});

describe("POST /api/stall/tokens", () => {
  it("creates a 90-second signed token and claim URL", async () => {
    const { req, raw } = await setup();
    const before = Date.now();
    const res = await req("/api/stall/tokens", { as: "u-seller-econ", body: { item_id: "econ-veg-egg", byo: true } });
    expect(res.status).toBe(201);
    expect(res.body.token.startsWith(`${res.body.id}.`)).toBe(true);
    expect(res.body.claim_url).toBe(`https://app.test/claim?t=${encodeURIComponent(res.body.token)}`);
    expect(res.body.expires_at - before).toBeGreaterThanOrEqual(90_000);
    expect(res.body.expires_at - before).toBeLessThan(95_000);
    const row = raw.prepare("SELECT stall_id, item_id, byo, method, used_at FROM tokens WHERE id=?").get(res.body.id);
    expect(row).toEqual({ stall_id: "econ-rice", item_id: "econ-veg-egg", byo: 1, method: "qr", used_at: null });
  });

  it("rejects another stall's item", async () => {
    const { req } = await setup();
    const res = await req("/api/stall/tokens", { as: "u-seller-econ", body: { item_id: "kopi" } });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("wrong_stall");
  });

  it("rejects unknown and draft items", async () => {
    const { req, raw } = await setup();
    raw.exec("UPDATE items SET status='draft' WHERE id='econ-pork'");
    for (const item_id of ["nope", "econ-pork", undefined]) {
      const res = await req("/api/stall/tokens", { as: "u-seller-econ", body: { item_id } });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("no_item");
    }
  });

  it("rejects when the stall is inactive", async () => {
    const { req, raw } = await setup();
    raw.exec("UPDATE stalls SET active=0 WHERE id='econ-rice'");
    const res = await req("/api/stall/tokens", { as: "u-seller-econ", body: { item_id: "econ-veg-egg" } });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("stall_inactive");
  });
});

describe("GET /api/stall/tokens/:id", () => {
  it("reports pending, then expired", async () => {
    const { req, raw } = await setup();
    const t = await req("/api/stall/tokens", { as: "u-seller-econ", body: { item_id: "econ-veg-egg" } });
    expect((await req(`/api/stall/tokens/${t.body.id}`, { as: "u-seller-econ" })).body).toMatchObject({ state: "pending", claimed_by: null });
    raw.exec(`UPDATE tokens SET expires_at = 0 WHERE id = '${t.body.id}'`);
    expect((await req(`/api/stall/tokens/${t.body.id}`, { as: "u-seller-econ" })).body.state).toBe("expired");
  });

  it("reports claimed with the student's name", async () => {
    const { req, raw } = await setup();
    const t = await req("/api/stall/tokens", { as: "u-seller-econ", body: { item_id: "econ-veg-egg" } });
    raw.exec(`UPDATE tokens SET used_at = 1, used_by = 'u-alex' WHERE id = '${t.body.id}'`);
    expect((await req(`/api/stall/tokens/${t.body.id}`, { as: "u-seller-econ" })).body).toMatchObject({ state: "claimed", claimed_by: "Alex" });
  });

  it("hides other stalls' tokens", async () => {
    const { req } = await setup();
    const t = await req("/api/stall/tokens", { as: "u-seller-econ", body: { item_id: "econ-veg-egg" } });
    expect((await req(`/api/stall/tokens/${t.body.id}`, { as: "u-seller-drinks" })).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/stall.test.ts`
Expected: FAIL (404s)

- [ ] **Step 3: Implement** `src/worker/routes/stall.ts`

```ts
import { Hono } from "hono";
import { loadSettings } from "../db";
import type { AppEnv } from "../env";
import { fail } from "../http";
import { sign } from "../lib/token";
import { requireRole } from "../session";

export const stall = new Hono<AppEnv>();
const seller = requireRole("seller");

type StallRow = { id: string; name: string; canteen: string; active: number; verify_method: string };

stall.get("/stall", seller, async (c) => {
  const db = c.env.DB;
  const s = await db
    .prepare("SELECT id, name, canteen, active, verify_method FROM stalls WHERE id = ?")
    .bind(c.get("user")!.stall_id)
    .first<StallRow>();
  if (!s) return fail(c, 404, "no_stall", "This seller account isn't linked to a stall.");
  const { results } = await db
    .prepare("SELECT id, name, kind, kg_co2e, low_carbon FROM items WHERE stall_id = ? AND status = 'live' ORDER BY kind DESC, name")
    .bind(s.id)
    .all<{ id: string; name: string; kind: string; kg_co2e: number | null; low_carbon: number }>();
  return c.json({
    stall: { ...s, active: s.active === 1 },
    items: results.map((i) => ({ ...i, low_carbon: i.low_carbon === 1 })),
  });
});

stall.post("/stall/tokens", seller, async (c) => {
  const db = c.env.DB;
  const user = c.get("user")!;
  const body = (await c.req.json().catch(() => ({}))) as { item_id?: unknown; byo?: unknown };
  const item =
    typeof body.item_id === "string"
      ? await db
          .prepare("SELECT i.id, i.stall_id, i.status, s.active FROM items i JOIN stalls s ON s.id = i.stall_id WHERE i.id = ?")
          .bind(body.item_id)
          .first<{ id: string; stall_id: string; status: string; active: number }>()
      : null;
  if (!item || item.status !== "live") return fail(c, 404, "no_item", "That item isn't on the menu.");
  if (item.stall_id !== user.stall_id) return fail(c, 403, "wrong_stall", "That item belongs to another stall.");
  if (item.active !== 1) return fail(c, 403, "stall_inactive", "This stall isn't taking claims right now.");

  const settings = await loadSettings(db);
  const id = crypto.randomUUID();
  const now = Date.now();
  const expires_at = now + settings.token_ttl_sec * 1000;
  await db
    .prepare("INSERT INTO tokens (id, stall_id, item_id, byo, method, created_at, expires_at) VALUES (?, ?, ?, ?, 'qr', ?, ?)")
    .bind(id, item.stall_id, item.id, body.byo === true ? 1 : 0, now, expires_at)
    .run();
  const token = await sign(id, c.env.TOKEN_SECRET);
  const claim_url = `${new URL(c.req.url).origin}/claim?t=${encodeURIComponent(token)}`;
  return c.json({ id, token, claim_url, expires_at }, 201);
});

stall.get("/stall/tokens/:id", seller, async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT t.stall_id, t.expires_at, t.used_at, u.display_name AS claimed_by FROM tokens t LEFT JOIN users u ON u.id = t.used_by WHERE t.id = ?",
  )
    .bind(c.req.param("id"))
    .first<{ stall_id: string; expires_at: number; used_at: number | null; claimed_by: string | null }>();
  if (!row || row.stall_id !== c.get("user")!.stall_id) return fail(c, 404, "no_token", "Code not found.");
  const state = row.used_at != null ? "claimed" : Date.now() > row.expires_at ? "expired" : "pending";
  return c.json({ state, expires_at: row.expires_at, claimed_by: row.claimed_by ?? null });
});
```

Modify `src/worker/app.ts`: add `import { stall } from "./routes/stall";` and `app.route("/", stall);` after `app.route("/", auth);`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/stall.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/worker/routes/stall.ts src/worker/app.ts test/stall.test.ts
git commit -m "feat(stall): seller menu, QR token creation, token status polling"
```

---

### Task 9: The claim endpoint

**Files:**
- Create: `src/worker/activities.ts`, `src/worker/routes/claim.ts`
- Modify: `src/worker/app.ts` (add `app.route("/", claim)`)
- Test: `test/claim.test.ts`

**Interfaces:**
- Consumes: `verify` (Task 4); `sgDayStart` (Task 5); `stallClaimPoints`, `byoPoints` (Task 5); `loadSettings` (Task 7); stall token API (Task 8)
- Produces:
  - `type NewActivity` and `insertActivity(db, a): D1PreparedStatement` (Stage 2 reuses both)
  - `POST /api/claim {t}` → 200 `{ item_name, stall_name, kind, low_carbon, kg_co2e, points, activities: {type, points, kg_co2e}[] }`
  - errors:
    - `401 no_session`
    - `403 not_student`
    - `400 invalid_token`
    - `409 used`
    - `410 expired`
    - `403 stall_inactive`
    - `429 rate_limited`
    - `429 daily_limit`

- [ ] **Step 1: Write the failing test** `test/claim.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { setup } from "./helpers/setup";

async function makeToken(ctx: Awaited<ReturnType<typeof setup>>, seller: string, item_id: string, byo = false) {
  const res = await ctx.req("/api/stall/tokens", { as: seller, body: { item_id, byo } });
  expect(res.status).toBe(201);
  return res.body as { id: string; token: string };
}

describe("POST /api/claim — success", () => {
  it("awards low-carbon meal + BYO and marks the token used", async () => {
    const ctx = await setup();
    const t = await makeToken(ctx, "u-seller-econ", "econ-veg-egg", true);
    const res = await ctx.req("/api/claim", { as: "u-alex", body: { t: t.token } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ item_name: "Economy rice: 2 veg + egg", low_carbon: true, kg_co2e: 0.65, points: 35 });
    expect(res.body.activities).toEqual([
      { type: "meal", points: 20, kg_co2e: 0.65 },
      { type: "byo", points: 15, kg_co2e: null },
    ]);
    const acts = ctx.raw.prepare("SELECT category, type, verified, source, token_id, low_carbon FROM activities WHERE user_id='u-alex' ORDER BY type DESC").all();
    expect(acts).toEqual([
      { category: "food", type: "meal", verified: 1, source: "qr", token_id: t.id, low_carbon: 1 },
      { category: "waste", type: "byo", verified: 1, source: "qr", token_id: t.id, low_carbon: null },
    ]);
    expect((ctx.raw.prepare("SELECT used_by FROM tokens WHERE id=?").get(t.id) as any).used_by).toBe("u-alex");
  });

  it("records a non-low-carbon meal with 0 points", async () => {
    const ctx = await setup();
    const t = await makeToken(ctx, "u-seller-noodles", "chicken-rice");
    const res = await ctx.req("/api/claim", { as: "u-alex", body: { t: t.token } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ low_carbon: false, kg_co2e: 1.36, points: 0 });
  });

  it("records a drink with unknown kg as NULL, not 0", async () => {
    const ctx = await setup();
    const t = await makeToken(ctx, "u-seller-drinks", "teh-o-kosong");
    const res = await ctx.req("/api/claim", { as: "u-alex", body: { t: t.token } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ kind: "drink", kg_co2e: null, points: 0 });
    const row = ctx.raw.prepare("SELECT kg_co2e, low_carbon, type FROM activities WHERE user_id='u-alex'").get();
    expect(row).toEqual({ kg_co2e: null, low_carbon: null, type: "drink" });
  });
});

describe("POST /api/claim — rejections", () => {
  it("needs a session and does not burn the token", async () => {
    const ctx = await setup();
    const t = await makeToken(ctx, "u-seller-econ", "econ-veg-egg");
    const res = await ctx.req("/api/claim", { body: { t: t.token } });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("no_session");
    expect((ctx.raw.prepare("SELECT used_at FROM tokens WHERE id=?").get(t.id) as any).used_at).toBeNull();
  });

  it("blocks sellers and admins", async () => {
    const ctx = await setup();
    const t = await makeToken(ctx, "u-seller-econ", "econ-veg-egg");
    for (const as of ["u-seller-econ", "u-admin"]) {
      const res = await ctx.req("/api/claim", { as, body: { t: t.token } });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("not_student");
    }
  });

  it.each([[""], ["garbage"], ["abc.def"], [null], [42], [undefined]])("invalid token %j → 400", async (bad) => {
    const ctx = await setup();
    const res = await ctx.req("/api/claim", { as: "u-alex", body: { t: bad } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_token");
  });

  it("tampered signature → 400", async () => {
    const ctx = await setup();
    const t = await makeToken(ctx, "u-seller-econ", "econ-veg-egg");
    const res = await ctx.req("/api/claim", { as: "u-alex", body: { t: t.token.slice(0, -3) + "AAA" } });
    expect(res.status).toBe(400);
  });

  it("body that is not JSON → 400", async () => {
    const ctx = await setup();
    const res = await ctx.req("/api/claim", { as: "u-alex", method: "POST" });
    expect(res.status).toBe(400);
  });

  it("second claim of the same token → 409", async () => {
    const ctx = await setup();
    const t = await makeToken(ctx, "u-seller-econ", "econ-veg-egg");
    expect((await ctx.req("/api/claim", { as: "u-alex", body: { t: t.token } })).status).toBe(200);
    const again = await ctx.req("/api/claim", { as: "u-bea", body: { t: t.token } });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("used");
  });

  it("two simultaneous claims: exactly one wins", async () => {
    const ctx = await setup();
    const t = await makeToken(ctx, "u-seller-econ", "econ-veg-egg");
    const results = await Promise.all([
      ctx.req("/api/claim", { as: "u-alex", body: { t: t.token } }),
      ctx.req("/api/claim", { as: "u-bea", body: { t: t.token } }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((ctx.raw.prepare("SELECT COUNT(*) AS n FROM activities").get() as any).n).toBe(1);
  });

  it("expired → 410", async () => {
    const ctx = await setup();
    const t = await makeToken(ctx, "u-seller-econ", "econ-veg-egg");
    ctx.raw.exec(`UPDATE tokens SET expires_at = ${Date.now() - 1} WHERE id = '${t.id}'`);
    const res = await ctx.req("/api/claim", { as: "u-alex", body: { t: t.token } });
    expect(res.status).toBe(410);
    expect(res.body.error).toBe("expired");
  });

  it("inactive stall → 403", async () => {
    const ctx = await setup();
    const t = await makeToken(ctx, "u-seller-econ", "econ-veg-egg");
    ctx.raw.exec("UPDATE stalls SET active = 0 WHERE id = 'econ-rice'");
    const res = await ctx.req("/api/claim", { as: "u-alex", body: { t: t.token } });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("stall_inactive");
  });

  it("same stall within 10 minutes → 429 rate_limited", async () => {
    const ctx = await setup();
    const t1 = await makeToken(ctx, "u-seller-econ", "econ-veg-egg");
    const t2 = await makeToken(ctx, "u-seller-econ", "econ-veg-tofu");
    expect((await ctx.req("/api/claim", { as: "u-alex", body: { t: t1.token } })).status).toBe(200);
    const res = await ctx.req("/api/claim", { as: "u-alex", body: { t: t2.token } });
    expect(res.status).toBe(429);
    expect(res.body.error).toBe("rate_limited");
    expect((ctx.raw.prepare("SELECT used_at FROM tokens WHERE id=?").get(t2.id) as any).used_at).toBeNull();
  });

  it("same stall after 10 minutes is allowed", async () => {
    const ctx = await setup();
    ctx.raw.exec(
      `INSERT INTO activities (id,user_id,category,type,points,verified,source,stall_id,created_at) VALUES ('old','u-alex','food','meal',20,1,'qr','econ-rice',${Date.now() - 11 * 60_000})`,
    );
    const t = await makeToken(ctx, "u-seller-econ", "econ-veg-egg");
    expect((await ctx.req("/api/claim", { as: "u-alex", body: { t: t.token } })).status).toBe(200);
  });

  it("sixth verified claim today → 429 daily_limit", async () => {
    const ctx = await setup();
    const ago = Date.now() - 20 * 60_000; // outside the per-stall window, still today in SGT unless run just after midnight
    for (let i = 0; i < 5; i++) {
      ctx.raw.exec(
        `INSERT INTO activities (id,user_id,category,type,points,verified,source,stall_id,created_at) VALUES ('d${i}','u-alex','food','meal',0,1,'qr','noodles',${ago})`,
      );
    }
    const t = await makeToken(ctx, "u-seller-econ", "econ-veg-egg");
    const res = await ctx.req("/api/claim", { as: "u-alex", body: { t: t.token } });
    expect(res.status).toBe(429);
    expect(res.body.error).toBe("daily_limit");
  });
});
```

Note on the daily-limit test: if the suite runs within 20 minutes after 00:00 SGT, `ago` falls on the previous day and the test fails. That's acceptable for a prototype; if it bites, re-run.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/claim.test.ts`
Expected: FAIL (404s)

- [ ] **Step 3: Implement**

`src/worker/activities.ts`:
```ts
export type NewActivity = {
  user_id: string;
  category: "food" | "mobility" | "waste";
  type: "meal" | "drink" | "byo" | "trip" | "steps" | "container_return";
  kg_co2e: number | null;
  points: number;
  verified: boolean;
  source: "qr" | "nfc" | "manual" | "photo";
  token_id?: string | null;
  stall_id?: string | null;
  item_id?: string | null;
  low_carbon?: boolean | null;
  image_hash?: string | null;
  detail?: Record<string, unknown>;
  created_at: number;
};

export function insertActivity(db: D1Database, a: NewActivity): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO activities (id, user_id, category, type, kg_co2e, points, verified, source, token_id, stall_id, item_id, low_carbon, image_hash, detail_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      a.user_id,
      a.category,
      a.type,
      a.kg_co2e,
      a.points,
      a.verified ? 1 : 0,
      a.source,
      a.token_id ?? null,
      a.stall_id ?? null,
      a.item_id ?? null,
      a.low_carbon == null ? null : a.low_carbon ? 1 : 0,
      a.image_hash ?? null,
      JSON.stringify(a.detail ?? {}),
      a.created_at,
    );
}
```

`src/worker/routes/claim.ts`:
```ts
import { Hono } from "hono";
import { insertActivity } from "../activities";
import { loadSettings } from "../db";
import type { AppEnv } from "../env";
import { fail } from "../http";
import { byoPoints, stallClaimPoints } from "../lib/scoring";
import { sgDayStart } from "../lib/time";
import { verify } from "../lib/token";

export const claim = new Hono<AppEnv>();

type TokenRow = {
  id: string;
  stall_id: string;
  item_id: string;
  byo: number;
  method: string;
  expires_at: number;
  used_at: number | null;
  item_name: string;
  kind: "meal" | "drink";
  kg_co2e: number | null;
  low_carbon: number;
  item_points: number | null;
  stall_name: string;
  active: number;
};

const INVALID = "This code isn't valid. Ask the stall for a new one.";

claim.post("/claim", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  if (!user) return fail(c, 401, "no_session", "Enter a display name first.");
  if (user.role !== "student") return fail(c, 403, "not_student", "Seller and admin accounts can't claim points.");

  const body = (await c.req.json().catch(() => ({}))) as { t?: unknown };
  const id = await verify(body.t, c.env.TOKEN_SECRET);
  if (!id) return fail(c, 400, "invalid_token", INVALID);

  const tok = await db
    .prepare(
      `SELECT t.id, t.stall_id, t.item_id, t.byo, t.method, t.expires_at, t.used_at,
              i.name AS item_name, i.kind, i.kg_co2e, i.low_carbon, i.points AS item_points,
              s.name AS stall_name, s.active
       FROM tokens t JOIN items i ON i.id = t.item_id JOIN stalls s ON s.id = t.stall_id
       WHERE t.id = ?`,
    )
    .bind(id)
    .first<TokenRow>();
  if (!tok || tok.method !== "qr") return fail(c, 400, "invalid_token", INVALID);
  if (tok.used_at != null) return fail(c, 409, "used", "This code has already been used.");
  const now = Date.now();
  if (now > tok.expires_at) return fail(c, 410, "expired", "This code has expired. Ask the stall for a new one.");
  if (tok.active !== 1) return fail(c, 403, "stall_inactive", "This stall isn't taking claims right now.");

  const s = await loadSettings(db);
  const recent = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM activities WHERE user_id = ? AND stall_id = ? AND type IN ('meal','drink') AND verified = 1 AND created_at > ?",
    )
    .bind(user.id, tok.stall_id, now - s.rate_stall_window_min * 60_000)
    .first<number>("n");
  if ((recent ?? 0) > 0) {
    return fail(c, 429, "rate_limited", `You can claim at this stall once every ${s.rate_stall_window_min} minutes.`);
  }
  const today = await db
    .prepare("SELECT COUNT(*) AS n FROM activities WHERE user_id = ? AND type IN ('meal','drink') AND verified = 1 AND created_at >= ?")
    .bind(user.id, sgDayStart(now))
    .first<number>("n");
  if ((today ?? 0) >= s.rate_daily_max) {
    return fail(c, 429, "daily_limit", `You've reached today's limit of ${s.rate_daily_max} claims.`);
  }

  const upd = await db
    .prepare("UPDATE tokens SET used_at = ?, used_by = ? WHERE id = ? AND used_at IS NULL")
    .bind(now, user.id, tok.id)
    .run();
  if (upd.meta.changes !== 1) return fail(c, 409, "used", "This code has already been used.");

  const low = tok.kind === "meal" && tok.low_carbon === 1;
  const mainPoints = stallClaimPoints({ kind: tok.kind, low_carbon: low, points: tok.item_points }, s);
  const base = { user_id: user.id, verified: true, source: "qr" as const, token_id: tok.id, stall_id: tok.stall_id, created_at: now };
  const stmts = [
    insertActivity(db, {
      ...base,
      category: "food",
      type: tok.kind,
      kg_co2e: tok.kg_co2e,
      points: mainPoints,
      item_id: tok.item_id,
      low_carbon: tok.kind === "meal" ? low : null,
    }),
  ];
  const activities = [{ type: tok.kind as string, points: mainPoints, kg_co2e: tok.kg_co2e }];
  if (tok.byo === 1) {
    const p = byoPoints(s);
    stmts.push(insertActivity(db, { ...base, category: "waste", type: "byo", kg_co2e: null, points: p }));
    activities.push({ type: "byo", points: p, kg_co2e: null });
  }
  await db.batch(stmts);

  return c.json({
    item_name: tok.item_name,
    stall_name: tok.stall_name,
    kind: tok.kind,
    low_carbon: low,
    kg_co2e: tok.kg_co2e,
    points: activities.reduce((n, a) => n + a.points, 0),
    activities,
  });
});
```

Modify `src/worker/app.ts`: add `import { claim } from "./routes/claim";` and `app.route("/", claim);`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/claim.test.ts`
Expected: PASS (all tests, including "exactly one wins")

- [ ] **Step 5: Commit**

```bash
git add src/worker/activities.ts src/worker/routes/claim.ts src/worker/app.ts test/claim.test.ts
git commit -m "feat(claim): verified QR claim with atomic single-use and rate limits"
```

---

### Task 10: Student summary endpoint

**Files:**
- Create: `src/worker/routes/me.ts`
- Modify: `src/worker/app.ts` (add `app.route("/", me)`)
- Test: `test/me.test.ts`

**Interfaces:**
- Consumes: `sgWeekStart` (Task 5); `requireRole` (Task 7)
- Produces: `GET /api/me/summary` → `{ points_total: number, points_week: number, recent: { type, points, kg_co2e, low_carbon: boolean|null, verified: boolean, item_name: string|null, created_at }[] }` (newest first, max 20)

- [ ] **Step 1: Write the failing test** `test/me.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { sgWeekStart } from "../src/worker/lib/time";
import { setup } from "./helpers/setup";

function insert(raw: any, id: string, points: number, created_at: number, extra = "") {
  raw.exec(
    `INSERT INTO activities (id,user_id,category,type,points,verified,source,item_id,low_carbon,kg_co2e,created_at)
     VALUES ('${id}','u-alex','food','meal',${points},1,'qr',${extra || "NULL"},1,0.65,${created_at})`,
  );
}

describe("GET /api/me/summary", () => {
  it("sums total and this-week points and lists recent activity", async () => {
    const { req, raw } = await setup();
    const weekStart = sgWeekStart(Date.now());
    insert(raw, "old", 20, weekStart - 1000);
    insert(raw, "new", 35, weekStart + 1000, "'econ-veg-egg'");
    const res = await req("/api/me/summary", { as: "u-alex" });
    expect(res.status).toBe(200);
    expect(res.body.points_total).toBe(55);
    expect(res.body.points_week).toBe(35);
    expect(res.body.recent[0]).toMatchObject({ type: "meal", points: 35, item_name: "Economy rice: 2 veg + egg", low_carbon: true, verified: true });
    expect(res.body.recent).toHaveLength(2);
  });

  it("returns zeros for a new student", async () => {
    const { req } = await setup();
    expect((await req("/api/me/summary", { as: "u-bea" })).body).toEqual({ points_total: 0, points_week: 0, recent: [] });
  });

  it("is student-only", async () => {
    const { req } = await setup();
    expect((await req("/api/me/summary", { as: "u-seller-econ" })).status).toBe(403);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/me.test.ts`
Expected: FAIL (404)

- [ ] **Step 3: Implement** `src/worker/routes/me.ts`

```ts
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { sgWeekStart } from "../lib/time";
import { requireRole } from "../session";

export const me = new Hono<AppEnv>();

me.get("/me/summary", requireRole("student"), async (c) => {
  const db = c.env.DB;
  const uid = c.get("user")!.id;
  const totals = await db
    .prepare("SELECT COALESCE(SUM(points),0) AS total, COALESCE(SUM(CASE WHEN created_at >= ? THEN points ELSE 0 END),0) AS week FROM activities WHERE user_id = ?")
    .bind(sgWeekStart(Date.now()), uid)
    .first<{ total: number; week: number }>();
  const { results } = await db
    .prepare(
      `SELECT a.type, a.points, a.kg_co2e, a.low_carbon, a.verified, a.created_at, i.name AS item_name
       FROM activities a LEFT JOIN items i ON i.id = a.item_id
       WHERE a.user_id = ? ORDER BY a.created_at DESC LIMIT 20`,
    )
    .bind(uid)
    .all<{ type: string; points: number; kg_co2e: number | null; low_carbon: number | null; verified: number; created_at: number; item_name: string | null }>();
  return c.json({
    points_total: totals?.total ?? 0,
    points_week: totals?.week ?? 0,
    recent: results.map((r) => ({
      ...r,
      low_carbon: r.low_carbon == null ? null : r.low_carbon === 1,
      verified: r.verified === 1,
    })),
  });
});
```

Modify `src/worker/app.ts`: add `import { me } from "./routes/me";` and `app.route("/", me);`.

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/worker/routes/me.ts src/worker/app.ts test/me.test.ts
git commit -m "feat(me): student points summary and recent activity"
```

---

### Task 11: Frontend shell, onboarding and student home

**Files:**
- Create: `src/app/styles.css`, `src/app/api.ts`, `src/app/router.ts`, `src/app/App.tsx`, `src/app/screens/Welcome.tsx`, `src/app/screens/Home.tsx`
- Modify: `src/app/main.tsx`

**Interfaces:**
- Consumes: `/api/me`, `/api/session`, `/api/me/summary`
- Produces:
  - `api<T>(path, body?)`, which throws `ApiError { status, code, message }`
  - `usePath()`, `navigate(to)`
  - `type Me = { user: User | null; can_switch: boolean }`
  - CSS classes used by later screens: `.page`, `.card`, `.glass`, `.btn`, `.btn-secondary`, `.pill`, `.pill-green`, `.big-number`, `.muted`, `.list`, `.row`, `.topbar`, `.error`

There are no unit tests for the UI. It is checked by the build and in the browser (Step 6).

- [ ] **Step 1: Write `src/app/styles.css`**

```css
:root {
  --bg: #f7f7f5;
  --card: #ffffff;
  --text: #1c1c1e;
  --muted: #6e6e73;
  --line: rgba(0, 0, 0, 0.08);
  --accent: #2e9e5b;
  --accent-soft: #e6f4ec;
  --danger: #d70015;
  --radius: 20px;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
  color: var(--text);
  -webkit-font-smoothing: antialiased;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); }
.page {
  max-width: 480px; margin: 0 auto;
  padding: calc(16px + env(safe-area-inset-top)) 16px calc(32px + env(safe-area-inset-bottom));
  display: flex; flex-direction: column; gap: 16px;
}
h1 { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; margin: 8px 0 0; }
h2 { font-size: 17px; font-weight: 600; margin: 0; }
.muted { color: var(--muted); font-size: 15px; }
.card { background: var(--card); border-radius: var(--radius); padding: 20px; box-shadow: 0 1px 2px rgba(0,0,0,.04); }
.glass {
  background: rgba(255, 255, 255, 0.62);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.7);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.08);
}
.big-number { font-size: 48px; font-weight: 700; letter-spacing: -0.03em; line-height: 1; }
.btn {
  appearance: none; border: 0; border-radius: 14px; padding: 14px 18px; width: 100%;
  font: inherit; font-weight: 600; font-size: 17px; background: var(--accent); color: #fff; cursor: pointer;
}
.btn:disabled { opacity: 0.5; }
.btn-secondary { background: var(--line); color: var(--text); }
.pill { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 13px; font-weight: 600; background: var(--line); }
.pill-green { background: var(--accent-soft); color: var(--accent); }
.list { display: flex; flex-direction: column; }
.row { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--line); }
.row:last-child { border-bottom: 0; }
.topbar { display: flex; justify-content: space-between; align-items: center; }
.error { color: var(--danger); }
input[type="text"] {
  width: 100%; padding: 14px 16px; border-radius: 14px; border: 1px solid var(--line);
  font: inherit; font-size: 17px; background: var(--card);
}
```

- [ ] **Step 2: Write `src/app/api.ts` and `src/app/router.ts`**

`src/app/api.ts`:
```ts
export type Role = "student" | "seller" | "admin";
export type User = { id: string; display_name: string; role: Role; stall_id: string | null };
export type Me = { user: User | null; can_switch: boolean };

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? "unknown", data.message ?? "Something went wrong.");
  return data as T;
}
```

`src/app/router.ts`:
```ts
import { useEffect, useState } from "react";

export function usePath(): string {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    addEventListener("popstate", on);
    return () => removeEventListener("popstate", on);
  }, []);
  return path;
}

export function navigate(to: string) {
  history.pushState(null, "", to);
  dispatchEvent(new PopStateEvent("popstate"));
}
```

- [ ] **Step 3: Write the screens**

`src/app/screens/Welcome.tsx`:
```tsx
import { useState } from "react";
import { api, ApiError } from "../api";

export function Welcome({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/session", { display_name: name });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <form className="page" onSubmit={submit}>
      <h1>Campus Carbon</h1>
      <p className="muted">Earn points for low-carbon meals and bringing your own cup. What should we call you?</p>
      <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name" maxLength={30} autoFocus />
      {error && <p className="error">{error}</p>}
      <button className="btn" disabled={busy || name.trim() === ""}>Continue</button>
    </form>
  );
}
```

`src/app/screens/Home.tsx`:
```tsx
import { useEffect, useState } from "react";
import { api, type User } from "../api";

type Summary = {
  points_total: number;
  points_week: number;
  recent: { type: string; points: number; kg_co2e: number | null; low_carbon: boolean | null; verified: boolean; item_name: string | null; created_at: number }[];
};

const LABEL: Record<string, string> = { meal: "Meal", drink: "Drink", byo: "Brought own container" };

export function Home({ user }: { user: User }) {
  const [data, setData] = useState<Summary | null>(null);
  useEffect(() => {
    api<Summary>("/me/summary").then(setData).catch(() => setData(null));
  }, []);

  return (
    <>
      <h1>Hi, {user.display_name}</h1>
      <div className="card">
        <p className="muted">Points this week</p>
        <div className="big-number">{data?.points_week ?? "–"}</div>
        <p className="muted">{data ? `${data.points_total} all time` : ""}</p>
      </div>
      <div className="card">
        <h2>Recent</h2>
        {data && data.recent.length === 0 && <p className="muted">Scan a stall's QR code after buying to earn points.</p>}
        <div className="list">
          {data?.recent.map((a, i) => (
            <div className="row" key={i}>
              <div>
                <div>{a.item_name ?? LABEL[a.type] ?? a.type}</div>
                <div className="muted">
                  {a.kg_co2e == null ? "—" : `${a.kg_co2e} kg CO₂e`} · {a.verified ? "verified" : "self-reported"}
                </div>
              </div>
              <span className={a.low_carbon ? "pill pill-green" : "pill"}>+{a.points}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
```

`src/app/App.tsx` (the Stall, Claim and Admin screens come in Tasks 12–13; this version routes only what exists):
```tsx
import { useCallback, useEffect, useState } from "react";
import { api, type Me } from "./api";
import { navigate, usePath } from "./router";
import { Home } from "./screens/Home";
import { Welcome } from "./screens/Welcome";

export function App() {
  const path = usePath();
  const [me, setMe] = useState<Me | null>(null);
  const load = useCallback(() => api<Me>("/me").then(setMe), []);
  useEffect(() => {
    load().catch(() => setMe({ user: null, can_switch: false }));
  }, [load]);

  if (!me) return null;
  if (!me.user) return <Welcome onDone={load} />;

  return (
    <div className="page">
      {me.can_switch && (
        <div className="topbar">
          <span className="muted">{me.user.display_name} · {me.user.role}</span>
          <button className="pill" onClick={() => navigate("/admin")}>Switch</button>
        </div>
      )}
      {path === "/" && <Home user={me.user} />}
    </div>
  );
}
```

`src/app/main.tsx`:
```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 4: Build**

Run: `npm run build && npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Seed the local DB**

Run: `npm run db:local`
Expected: the migrations apply and the seed runs, with "Executed N commands".

- [ ] **Step 6: Check in the browser**

Create `.claude/launch.json` so the preview tool can start the dev server:
```json
{
  "version": "0.0.1",
  "configurations": [
    { "name": "dev", "runtimeExecutable": "npm", "runtimeArgs": ["run", "dev"], "port": 5173 }
  ]
}
```
Start it with the preview tool (config `dev`). Then:
1. Open `/`. The Welcome screen shows.
2. Enter "Test". Home shows "Hi, Test", 0 points, and the empty-state message.
3. Reload. You stay signed in.
4. Resize to mobile (375 px). There is no horizontal scroll.

- [ ] **Step 7: Commit**

```bash
git add src/app .claude/launch.json
git commit -m "feat(app): shell, onboarding and student home"
```

---

### Task 12: Seller stall screen with QR sheet

**Files:**
- Create: `src/app/screens/Stall.tsx`
- Modify: `src/app/App.tsx` (route `/stall`; sellers land on `/stall`), `src/app/styles.css` (grid and sheet styles)

**Interfaces:**
- Consumes: `GET /api/stall`, `POST /api/stall/tokens`, `GET /api/stall/tokens/:id` (Task 8); `qrcode` package `toDataURL`

- [ ] **Step 1: Add styles** to `src/app/styles.css`

```css
.grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
.item-btn {
  appearance: none; border: 0; text-align: left; font: inherit; cursor: pointer;
  background: var(--card); border-radius: 16px; padding: 14px; min-height: 96px;
  display: flex; flex-direction: column; justify-content: space-between; gap: 8px;
}
.item-btn:active { transform: scale(0.98); }
.toggle { display: flex; justify-content: space-between; align-items: center; }
.sheet-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.25); display: flex; align-items: flex-end; justify-content: center; }
.sheet {
  width: 100%; max-width: 480px; border-radius: 28px 28px 0 0; padding: 24px 20px calc(24px + env(safe-area-inset-bottom));
  display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center;
}
.sheet img { width: 280px; height: 280px; border-radius: 16px; background: #fff; }
```

- [ ] **Step 2: Write `src/app/screens/Stall.tsx`**

```tsx
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { api, ApiError } from "../api";

type Item = { id: string; name: string; kind: string; kg_co2e: number | null; low_carbon: boolean };
type StallData = { stall: { id: string; name: string; canteen: string; active: boolean }; items: Item[] };
type Created = { id: string; claim_url: string; expires_at: number };
type Status = { state: "pending" | "claimed" | "expired"; claimed_by: string | null };

export function Stall() {
  const [data, setData] = useState<StallData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [byo, setByo] = useState(false);
  const [active, setActive] = useState<(Created & { item: Item; qr: string }) | null>(null);

  useEffect(() => {
    api<StallData>("/stall").then(setData).catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load stall."));
  }, []);

  async function sell(item: Item) {
    setError(null);
    try {
      const t = await api<Created>("/stall/tokens", { item_id: item.id, byo });
      const qr = await QRCode.toDataURL(t.claim_url, { margin: 1, width: 560 });
      setActive({ ...t, item, qr });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't create a code.");
    }
  }

  function close() {
    setActive(null);
    setByo(false);
  }

  if (error && !data) return <p className="error">{error}</p>;
  if (!data) return null;

  return (
    <>
      <h1>{data.stall.name}</h1>
      <p className="muted">{data.stall.canteen} · tap the item sold</p>
      <div className="card toggle">
        <span>Customer brought own cup / container</span>
        <input type="checkbox" checked={byo} onChange={(e) => setByo(e.target.checked)} aria-label="BYO" />
      </div>
      {error && <p className="error">{error}</p>}
      <div className="grid">
        {data.items.map((i) => (
          <button key={i.id} className="item-btn" onClick={() => sell(i)}>
            <span>{i.name}</span>
            <span>
              {i.low_carbon && <span className="pill pill-green">Low-carbon</span>}{" "}
              <span className="muted">{i.kg_co2e == null ? "—" : `${i.kg_co2e} kg`}</span>
            </span>
          </button>
        ))}
      </div>
      {active && <QrSheet active={active} byo={byo} onClose={close} onRegenerate={() => sell(active.item)} />}
    </>
  );
}

function QrSheet({
  active,
  byo,
  onClose,
  onRegenerate,
}: {
  active: Created & { item: Item; qr: string };
  byo: boolean;
  onClose: () => void;
  onRegenerate: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  const [status, setStatus] = useState<Status>({ state: "pending", claimed_by: null });

  useEffect(() => {
    setStatus({ state: "pending", claimed_by: null });
    const tick = setInterval(() => setNow(Date.now()), 250);
    const poll = setInterval(async () => {
      try {
        const s = await api<Status>(`/stall/tokens/${active.id}`);
        setStatus(s);
      } catch {
        /* keep last status; next poll retries */
      }
    }, 2000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [active.id]);

  useEffect(() => {
    if (status.state !== "claimed") return;
    const t = setTimeout(onClose, 3000);
    return () => clearTimeout(t);
  }, [status.state, onClose]);

  const secondsLeft = Math.max(0, Math.ceil((active.expires_at - now) / 1000));
  const expired = status.state === "expired" || (status.state === "pending" && secondsLeft === 0);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet glass" onClick={(e) => e.stopPropagation()}>
        <h2>{active.item.name}{byo ? " + BYO" : ""}</h2>
        {status.state === "claimed" ? (
          <>
            <div className="big-number">✓</div>
            <p>Claimed by {status.claimed_by}</p>
          </>
        ) : expired ? (
          <>
            <p className="muted">Code expired</p>
            <button className="btn" onClick={onRegenerate}>New code</button>
          </>
        ) : (
          <>
            <img src={active.qr} alt="Claim QR code" />
            <p className="muted">Scan with your phone camera · {secondsLeft}s</p>
          </>
        )}
        <button className="btn btn-secondary" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Route it.** In `src/app/App.tsx`, import `Stall`, and replace the `{path === "/" && <Home …/>}` line with role-aware routing:

```tsx
      {me.user.role === "seller" && (path === "/" || path === "/stall") && <Stall />}
      {me.user.role === "student" && path === "/" && <Home user={me.user} />}
```

- [ ] **Step 4: Build**

Run: `npm run build && npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Check in the browser**

With the dev server running, sign in as a seller. The persona switcher only arrives in Task 13, so for now use the dev console: `await fetch('/api/admin/impersonate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({user_id:'u-seller-econ'})})`. That only works as admin, so first, in a terminal, run `npx wrangler d1 execute campus-carbon --local --command "UPDATE users SET role='admin' WHERE display_name='Test'"`, then reload. Then:
1. Open `/stall`. The five economy-rice items show, and the two veg ones have "Low-carbon" pills.
2. Tap an item. The sheet shows a QR code and a countdown from 90.
3. Leave it until expiry. "Code expired" and "New code" appear.

- [ ] **Step 6: Commit**

```bash
git add src/app
git commit -m "feat(app): seller stall view with QR sheet, countdown and claim status"
```

---

### Task 13: Claim screen and admin persona switcher

**Files:**
- Create: `src/app/screens/Claim.tsx`, `src/app/screens/Admin.tsx`
- Modify: `src/app/App.tsx` (routes `/claim`, `/admin`; keep `?t=` through onboarding)

**Interfaces:**
- Consumes: `POST /api/claim` (Task 9); `GET /api/admin/users`, `POST /api/admin/impersonate` (Task 7)

- [ ] **Step 1: Write `src/app/screens/Claim.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api";
import { navigate } from "../router";

type Result = {
  item_name: string;
  stall_name: string;
  kind: string;
  low_carbon: boolean;
  kg_co2e: number | null;
  points: number;
  activities: { type: string; points: number; kg_co2e: number | null }[];
};

export function Claim() {
  const started = useRef(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return; // StrictMode runs effects twice in dev; claim exactly once
    started.current = true;
    const t = new URLSearchParams(location.search).get("t") ?? "";
    history.replaceState(null, "", "/claim"); // a refresh must not retry a used token
    api<Result>("/claim", { t })
      .then(setResult)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again."));
  }, []);

  if (error) {
    return (
      <div className="card">
        <h2>Couldn't claim</h2>
        <p className="error">{error}</p>
        <button className="btn btn-secondary" onClick={() => navigate("/")}>Go home</button>
      </div>
    );
  }
  if (!result) return <p className="muted">Claiming…</p>;

  const byo = result.activities.find((a) => a.type === "byo");
  return (
    <div className="card" style={{ textAlign: "center" }}>
      <div className="big-number">+{result.points}</div>
      <p>{result.item_name}</p>
      <p className="muted">
        {result.stall_name} · {result.kg_co2e == null ? "—" : `${result.kg_co2e} kg CO₂e`}
      </p>
      {result.low_carbon && <p><span className="pill pill-green">Low-carbon meal</span></p>}
      {byo && <p className="muted">Includes +{byo.points} for bringing your own container</p>}
      <button className="btn" onClick={() => navigate("/")}>Done</button>
    </div>
  );
}
```

- [ ] **Step 2: Write `src/app/screens/Admin.tsx`**

```tsx
import { useEffect, useState } from "react";
import { api, type User } from "../api";

export function Admin() {
  const [users, setUsers] = useState<User[] | null>(null);
  useEffect(() => {
    api<{ users: User[] }>("/admin/users").then((d) => setUsers(d.users)).catch(() => setUsers([]));
  }, []);

  async function become(id: string) {
    await api("/admin/impersonate", { user_id: id });
    location.href = "/"; // full reload so every screen re-reads /api/me
  }

  return (
    <>
      <h1>Switch persona</h1>
      <div className="card list">
        {users?.map((u) => (
          <button key={u.id} className="row" style={{ background: "none", border: 0, font: "inherit", textAlign: "left", cursor: "pointer" }} onClick={() => become(u.id)}>
            <span>{u.display_name}</span>
            <span className="pill">{u.role}</span>
          </button>
        ))}
      </div>
    </>
  );
}
```

- [ ] **Step 3: Update routing in `src/app/App.tsx`**

Replace the body of `App` after `if (!me) return null;` with:
```tsx
  // Welcome keeps the current URL (including /claim?t=...), so the claim resumes after onboarding.
  if (!me.user) return <Welcome onDone={load} />;
  const role = me.user.role;

  return (
    <div className="page">
      {me.can_switch && path !== "/admin" && (
        <div className="topbar">
          <span className="muted">{me.user.display_name} · {role}</span>
          <button className="pill" onClick={() => navigate("/admin")}>Switch</button>
        </div>
      )}
      {path === "/claim" && <Claim />}
      {path === "/admin" && me.can_switch && <Admin />}
      {path !== "/claim" && path !== "/admin" && role === "seller" && <Stall />}
      {path !== "/claim" && path !== "/admin" && role === "student" && <Home user={me.user} />}
      {path !== "/claim" && path !== "/admin" && role === "admin" && <Admin />}
    </div>
  );
```
Add imports for `Claim` and `Admin`.

Why the resume works: `Welcome` never changes `location`. After `onDone` → `load()`, `me.user` is set, `path` is still `/claim`, and `location.search` still holds `t`, so `Claim` mounts and claims once.

- [ ] **Step 4: Build**

Run: `npm run build && npm run typecheck`
Expected: no errors.

- [ ] **Step 5: End-to-end check in the browser (two tabs)**

The preview browser has tabs that share one cookie jar, so use one tab and the persona switcher:
1. Sign in as the Task 12 admin and go to `/admin`. Switch to "Economy Rice seller".
2. Tap "Economy rice: 2 veg + egg" with BYO on. Read the claim URL: in the console, run `document.querySelector('.sheet img')` and use `read_network_requests` for `/api/stall/tokens` to copy `claim_url`.
3. Tap Switch, then Alex. Navigate to the copied `claim_url`. Expected: "+35", "Low-carbon meal", and the BYO line.
4. Navigate to the same URL again. Expected: "This code has already been used."
5. Switch back to the seller. Expected: the earlier sheet is closed, and a new code works.
6. Clear cookies (DevTools or a fresh private tab) and open a fresh `claim_url`. Expected: the Welcome screen; after entering a name, "+20" (or "+35" with BYO) shows **without scanning again**. This is Review Focus #2.

- [ ] **Step 6: Run all tests**

Run: `npx vitest run`
Expected: all PASS

- [ ] **Step 7: Commit**

```bash
git add src/app
git commit -m "feat(app): claim result screen and admin persona switcher"
```

---

### Task 14: Deploy and check on real phones

This task creates resources on the user's Cloudflare account. **Stop and get the user's go-ahead before Step 2.** The user runs `wrangler login` themselves, because it's interactive.

**Files:**
- Modify: `wrangler.jsonc` (the real `database_id`)
- Create: `docs/demo-checklist.md`

- [ ] **Step 1: The user logs in**

Ask the user to run:
```bash
npx wrangler login
```
Then verify with: `npx wrangler whoami`
Expected: shows their account.

- [ ] **Step 2: Create the remote D1 database** (after the user confirms)

Run: `npx wrangler d1 create campus-carbon`
Expected: prints a `database_id`. Replace the all-zero id in `wrangler.jsonc` with it.

- [ ] **Step 3: Apply the migrations and seed remotely**

```bash
npx wrangler d1 migrations apply campus-carbon --remote
npm run seed:sql
npx wrangler d1 execute campus-carbon --remote --file seed/seed.sql
```
Expected: both succeed.

- [ ] **Step 4: Set the secrets** (random values that never touch the terminal history)

```bash
openssl rand -base64 32 | npx wrangler secret put TOKEN_SECRET
openssl rand -base64 32 | npx wrangler secret put COOKIE_SECRET
```

If `secret put` fails because the Worker doesn't exist yet, run Step 5 first and then repeat this step.

- [ ] **Step 5: Deploy**

Run: `npm run deploy`
Expected: prints `https://campus-carbon.<subdomain>.workers.dev`.

Run: `curl -s https://campus-carbon.<subdomain>.workers.dev/api/health`
Expected: `{"ok":true}`

- [ ] **Step 6: Make yourself admin on the deployed app**

Open the URL, enter a name, then:
```bash
npx wrangler d1 execute campus-carbon --remote --command "UPDATE users SET role='admin' WHERE display_name='<your name>'"
```

- [ ] **Step 7: Write `docs/demo-checklist.md`**

```markdown
# Stage 1 demo checklist (real phones)

Seller device: laptop or tablet, switched to a seller persona.
Student devices: one iPhone, one Android.

- [ ] Seller taps a low-carbon item with BYO on → QR code and countdown show
- [ ] iPhone camera scans QR → opens Safari → Welcome (first time) → +35 shown without a second scan
- [ ] Seller screen shows "Claimed by <name>" within ~2 s
- [ ] Android camera / Google Lens scans a new QR → claim works
- [ ] Rescanning a used QR → "already used"
- [ ] Waiting 90 s → seller sees "Code expired" → New code works
- [ ] Same student, same stall, second claim within 10 min → rate-limit message
- [ ] Chicken rice claim → 0 points, 1.36 kg shown
- [ ] Student home shows points this week and recent activity
```

- [ ] **Step 8: The user runs the checklist on real phones, then commit**

```bash
git add wrangler.jsonc docs/demo-checklist.md
git commit -m "chore: deploy config and stage 1 demo checklist"
```
