# Stage 2b: Missions, Streaks, Badges and Leaderboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Students see daily and weekly missions with progress and bonus points, a day streak, five badges and a weekly leaderboard, through new Missions and Ranks tabs. Mission bonuses count toward points on Today and in the ranking.

**Architecture:**
- **Everything is computed on read from `activities`**, using pure functions in `src/worker/lib/`: missions, streaks, badges, ranking.
- **No running totals are stored.** A completed mission can't double-count or drift out of sync with the log, and no write path has to remember to "refresh" anything.
- **Scale:** at demo size (tens of students), loading a week of everyone's activity per leaderboard request is trivial.
- **Seed:** mission and badge definitions live as constants in code and are also seeded into the `missions` / `badges` tables for reference and export.

**Tech Stack:** same as Stages 1–2a. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-29-campus-carbon-app-design.md` (§6, §7, §11)

**Follows:** Stage 2a (merged). **Next:** Stage 3 (AI).

## Global Constraints

- **Missions** (spec §7), exact values:
  - Weekly: 2 low-carbon meals (+100), 5,000 steps (+100), BYO once (+80), all weekly missions done (+50 bonus).
  - Daily: walk one campus trip today (+20), log one low-carbon meal today (+20).
- **A mission pays once per period** (per SG day or per SG week). Periods are Asia/Singapore: day 00:00–23:59, week Monday–Sunday.
- **Mission rewards do not count toward the 30/day self-reported cap** (spec §7).
- **Streak:** consecutive SG days with at least one logged activity. A streak stays alive through today until midnight if yesterday had activity.
- **Badges** (spec §7):
  - Green Starter: first activity
  - Low-Carbon Foodie: 10 low-carbon meals
  - Campus Walker: 20 km walked in one week
  - Zero-Waste Hero: 10 BYO
  - Carbon Champion: top of last week's leaderboard
- **Leaderboard:** points this week, students only. Points = activity points + mission bonuses earned this week.
- **Design:** off-white/grey editorial style, serif headings and numbers, glass only on the tab bar.
- **Errors:** every error body is `{ error, message }`.
- All earlier stage constraints still hold.

## Review Focus

1. **A student logs a third low-carbon meal in a week.** The weekly +100 is not paid again. Pinned in Tasks 1 and 5.
2. **Meals at Sunday 23:59 and Monday 00:01 SGT.** They don't combine into one week's mission. Pinned in Task 1.
3. **Streak edges:** no activity yet today but activity yesterday keeps the streak; a one-day gap resets it; 23:59 and 00:01 count as two days. Pinned in Task 2.
4. **Leaderboard ties, zero-point students, sellers and admins, and a student outside the top 20.** Equal points share a rank. Zero-point students, sellers and admins aren't listed. "Me" is still returned. Pinned in Tasks 3 and 5.
5. **Steps split across entries** (2,600 + 2,600). These complete the 5,000-step mission. Pinned in Task 1.
6. **A brand-new student.** All missions show 0 progress, streak 0, every badge locked, leaderboard rank `null`. No errors. Pinned in Task 5.

---

## File Structure

```
src/worker/lib/missions.ts      MISSIONS, Act, MissionState, currentMissions, missionPoints
src/worker/lib/streak.ts        streak
src/worker/lib/badges.ts        BADGES, BadgeState, badgeStates
src/worker/lib/leaderboard.ts   Entry, Ranked, rank, periodPoints
src/worker/acts.ts              loadActs, standings (DB → pure libs)
src/worker/routes/progress.ts   GET /missions, GET /leaderboard
src/worker/routes/me.ts         (modify) mission bonuses in points_week / points_total
src/worker/app.ts               (modify) mount progress routes
seed/sql.ts                     (modify) seed missions and badges tables
src/app/copy.ts                 (modify) ordinal
src/app/components/TabBar.tsx   (modify) Today, Log, Missions, Ranks
src/app/screens/Missions.tsx    streak, daily and weekly missions, badges
src/app/screens/Ranks.tsx       weekly leaderboard
src/app/App.tsx                 (modify) routes /missions, /ranks
src/app/styles.css              (modify) progress bars, badge grid, rank rows
test/missions.test.ts, test/streak.test.ts, test/badges.test.ts, test/leaderboard.test.ts, test/progress.test.ts
test/seed.test.ts, test/me.test.ts, test/copy.test.ts   (modify)
```

---

### Task 1: Missions module

**Files:**
- Create: `src/worker/lib/missions.ts`, `test/missions.test.ts`

**Interfaces:**
- Consumes: `sgDayStart`, `sgWeekStart` (Stage 1)
- Produces:
  - `type Act = { created_at: number; type: string; low_carbon: number | null; points: number; detail: Record<string, unknown> }`
  - `type Mission = { id: string; name: string; category: string; metric: Metric; target: number; points: number; period: "daily" | "weekly" }`
  - `MISSIONS: Mission[]`
  - `type MissionState = Mission & { progress: number; completed: boolean }`
  - `currentMissions(acts: Act[], now: number): { daily: MissionState[]; weekly: MissionState[] }`
  - `missionPoints(acts: Act[], from: number, to: number): number`: bonus points for every day and week period with activity in `[from, to)`

- [ ] **Step 1: Write the failing test** `test/missions.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { currentMissions, missionPoints, MISSIONS, type Act } from "../src/worker/lib/missions";

const H = 3_600_000;
const DAY = 24 * H;
const MON = Date.UTC(2026, 8, 27, 16, 0); // Mon 28 Sep 00:00 SGT
const act = (at: number, type: string, extra: Partial<Act> = {}): Act => ({ created_at: at, type, low_carbon: null, points: 0, detail: {}, ...extra });
const lowMeal = (at: number) => act(at, "meal", { low_carbon: 1 });

describe("MISSIONS (spec §7)", () => {
  it("has the six spec missions with their points", () => {
    expect(MISSIONS.map((m) => [m.id, m.period, m.target, m.points])).toEqual([
      ["daily-low-meal", "daily", 1, 20],
      ["daily-walk", "daily", 1, 20],
      ["weekly-low-meals", "weekly", 2, 100],
      ["weekly-steps", "weekly", 5000, 100],
      ["weekly-byo", "weekly", 1, 80],
      ["weekly-all", "weekly", 3, 50],
    ]);
  });
});

describe("currentMissions", () => {
  it("starts at zero with nothing logged", () => {
    const m = currentMissions([], MON + 10 * H);
    expect(m.daily.map((s) => [s.id, s.progress, s.completed])).toEqual([["daily-low-meal", 0, false], ["daily-walk", 0, false]]);
    expect(m.weekly.every((s) => s.progress === 0 && !s.completed)).toBe(true);
  });

  it("tracks today's meal and walk, ignoring yesterday", () => {
    const acts = [lowMeal(MON + DAY + 12 * H), act(MON + DAY + 9 * H, "trip", { detail: { mode: "walk" } }), lowMeal(MON + 12 * H)];
    const m = currentMissions(acts, MON + DAY + 20 * H);
    expect(m.daily.every((s) => s.completed)).toBe(true);
    expect(m.weekly.find((s) => s.id === "weekly-low-meals")).toMatchObject({ progress: 2, completed: true });
  });

  it("does not count car or shuttle trips as walks", () => {
    const m = currentMissions([act(MON + H, "trip", { detail: { mode: "car" } })], MON + 2 * H);
    expect(m.daily.find((s) => s.id === "daily-walk")!.completed).toBe(false);
  });

  it("sums steps across entries and caps progress at the target", () => {
    const acts = [act(MON + H, "steps", { detail: { steps: 2600 } }), act(MON + DAY, "steps", { detail: { steps: 2600 } })];
    expect(currentMissions(acts, MON + 2 * DAY).weekly.find((s) => s.id === "weekly-steps")).toMatchObject({ progress: 5000, completed: true });
  });

  it("'all weekly' counts the other weekly missions", () => {
    const acts = [lowMeal(MON + H), lowMeal(MON + 2 * H), act(MON + 3 * H, "byo"), act(MON + 4 * H, "steps", { detail: { steps: 5000 } })];
    expect(currentMissions(acts, MON + 5 * H).weekly.find((s) => s.id === "weekly-all")).toMatchObject({ target: 3, progress: 3, completed: true });
  });

  it("does not combine Sunday 23:59 and Monday 00:01 into one week", () => {
    const acts = [lowMeal(MON - 60_000), lowMeal(MON + 60_000)];
    expect(currentMissions(acts, MON + H).weekly.find((s) => s.id === "weekly-low-meals")!.completed).toBe(false);
  });
});

describe("missionPoints", () => {
  it("pays each mission once per period", () => {
    const week = [lowMeal(MON + H), lowMeal(MON + 2 * H), lowMeal(MON + 3 * H), act(MON + 4 * H, "byo"), act(MON + 5 * H, "steps", { detail: { steps: 5000 } })];
    // Monday daily meal +20; weekly meals +100, steps +100, byo +80, all +50
    expect(missionPoints(week, MON, MON + 7 * DAY)).toBe(350);
  });

  it("pays daily missions on each day they complete", () => {
    const acts = [lowMeal(MON + H), lowMeal(MON + DAY + H)];
    // two daily meals +40, plus weekly low meals +100
    expect(missionPoints(acts, MON, MON + 7 * DAY)).toBe(140);
  });

  it("only counts periods with activity inside [from, to)", () => {
    const acts = [lowMeal(MON - DAY), lowMeal(MON + H)];
    expect(missionPoints(acts, MON, MON + 7 * DAY)).toBe(20);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/missions.test.ts`
Expected: FAIL, "Cannot find module"

- [ ] **Step 3: Implement** `src/worker/lib/missions.ts`

```ts
import { sgDayStart, sgWeekStart } from "./time";

export type Act = { created_at: number; type: string; low_carbon: number | null; points: number; detail: Record<string, unknown> };
type Metric = "low_carbon_meals" | "steps" | "byo" | "walk_trips" | "all_weekly";
type Period = "daily" | "weekly";
export type Mission = { id: string; name: string; category: string; metric: Metric; target: number; points: number; period: Period };
export type MissionState = Mission & { progress: number; completed: boolean };

export const MISSIONS: Mission[] = [
  { id: "daily-low-meal", name: "Eat one low-carbon meal today", category: "food", metric: "low_carbon_meals", target: 1, points: 20, period: "daily" },
  { id: "daily-walk", name: "Walk one campus trip today", category: "mobility", metric: "walk_trips", target: 1, points: 20, period: "daily" },
  { id: "weekly-low-meals", name: "Eat 2 low-carbon meals this week", category: "food", metric: "low_carbon_meals", target: 2, points: 100, period: "weekly" },
  { id: "weekly-steps", name: "Walk 5,000 steps this week", category: "mobility", metric: "steps", target: 5000, points: 100, period: "weekly" },
  { id: "weekly-byo", name: "Bring your own cup or container once", category: "waste", metric: "byo", target: 1, points: 80, period: "weekly" },
  { id: "weekly-all", name: "Complete every weekly mission", category: "all", metric: "all_weekly", target: 3, points: 50, period: "weekly" },
];

function metricValue(metric: Metric, acts: Act[]): number {
  switch (metric) {
    case "low_carbon_meals":
      return acts.filter((a) => a.type === "meal" && a.low_carbon === 1).length;
    case "steps":
      return acts.reduce((n, a) => (a.type === "steps" ? n + (Number(a.detail.steps) || 0) : n), 0);
    case "byo":
      return acts.filter((a) => a.type === "byo").length;
    case "walk_trips":
      return acts.filter((a) => a.type === "trip" && a.detail.mode === "walk").length;
    case "all_weekly":
      return 0; // derived from the other weekly missions in statesFor
  }
}

/** Mission states for one period, given only that period's activity. */
function statesFor(period: Period, acts: Act[]): MissionState[] {
  const list = MISSIONS.filter((m) => m.period === period);
  const base = list
    .filter((m) => m.metric !== "all_weekly")
    .map((m) => {
      const v = metricValue(m.metric, acts);
      return { ...m, progress: Math.min(v, m.target), completed: v >= m.target };
    });
  const done = base.filter((b) => b.completed).length;
  const all = list
    .filter((m) => m.metric === "all_weekly")
    .map((m) => ({ ...m, target: base.length, progress: done, completed: base.length > 0 && done === base.length }));
  return [...base, ...all];
}

export function currentMissions(acts: Act[], now: number): { daily: MissionState[]; weekly: MissionState[] } {
  const day = sgDayStart(now);
  const week = sgWeekStart(now);
  return {
    daily: statesFor("daily", acts.filter((a) => a.created_at >= day && a.created_at <= now)),
    weekly: statesFor("weekly", acts.filter((a) => a.created_at >= week && a.created_at <= now)),
  };
}

/** Bonus points for every daily and weekly period that has activity in [from, to). */
export function missionPoints(acts: Act[], from: number, to: number): number {
  const inRange = acts.filter((a) => a.created_at >= from && a.created_at < to);
  let total = 0;
  for (const [period, keyOf] of [["daily", sgDayStart], ["weekly", sgWeekStart]] as const) {
    const groups = new Map<number, Act[]>();
    for (const a of inRange) {
      const k = keyOf(a.created_at);
      groups.set(k, [...(groups.get(k) ?? []), a]);
    }
    for (const g of groups.values()) {
      total += statesFor(period, g).reduce((n, s) => (s.completed ? n + s.points : n), 0);
    }
  }
  return total;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run test/missions.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/worker/lib/missions.ts test/missions.test.ts
git commit -m "feat(lib): daily and weekly missions computed from activity"
```

---

### Task 2: Streak and badges

**Files:**
- Create: `src/worker/lib/streak.ts`, `src/worker/lib/badges.ts`, `test/streak.test.ts`, `test/badges.test.ts`

**Interfaces:**
- Consumes: `Act` (Task 1), `sgDayStart`, `sgWeekStart`
- Produces:
  - `streak(times: number[], now: number): number`
  - `BADGES: { id: string; name: string; rule: string }[]`
  - `type BadgeState = { id: string; name: string; rule: string; earned_at: number | null }`
  - `badgeStates(acts: Act[], championOfWeek: number | null): BadgeState[]`, where `championOfWeek` is the start of the week the student topped, or null

- [ ] **Step 1: Write the failing tests**

`test/streak.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { streak } from "../src/worker/lib/streak";

const H = 3_600_000;
const DAY = 24 * H;
const MON = Date.UTC(2026, 8, 27, 16, 0); // Mon 00:00 SGT

describe("streak", () => {
  it("is 0 with no activity", () => expect(streak([], MON + DAY)).toBe(0));
  it("counts consecutive days ending today", () => {
    expect(streak([MON + H, MON + DAY + H, MON + 2 * DAY + H], MON + 2 * DAY + 5 * H)).toBe(3);
  });
  it("stays alive today if yesterday had activity", () => {
    expect(streak([MON + H, MON + DAY + H], MON + 2 * DAY + 20 * H)).toBe(2);
  });
  it("resets after a missed day", () => {
    expect(streak([MON + H, MON + 2 * DAY + H], MON + 2 * DAY + 5 * H)).toBe(1);
    expect(streak([MON + H], MON + 2 * DAY + 5 * H)).toBe(0);
  });
  it("counts 23:59 and 00:01 SGT as two days", () => {
    expect(streak([MON - 60_000, MON + 60_000], MON + H)).toBe(2);
  });
  it("counts several actions on one day once", () => {
    expect(streak([MON + H, MON + 2 * H, MON + 3 * H], MON + 4 * H)).toBe(1);
  });
});
```

`test/badges.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { badgeStates } from "../src/worker/lib/badges";
import type { Act } from "../src/worker/lib/missions";

const H = 3_600_000;
const DAY = 24 * H;
const MON = Date.UTC(2026, 8, 27, 16, 0);
const act = (at: number, type: string, extra: Partial<Act> = {}): Act => ({ created_at: at, type, low_carbon: null, points: 0, detail: {}, ...extra });
const earned = (acts: Act[], champ: number | null = null) =>
  Object.fromEntries(badgeStates(acts, champ).map((b) => [b.id, b.earned_at]));

describe("badgeStates (spec §7)", () => {
  it("lists five locked badges for a new student", () => {
    const b = badgeStates([], null);
    expect(b.map((x) => x.id)).toEqual(["green-starter", "low-carbon-foodie", "campus-walker", "zero-waste-hero", "carbon-champion"]);
    expect(b.every((x) => x.earned_at === null)).toBe(true);
  });

  it("Green Starter is earned at the first activity", () => {
    expect(earned([act(MON + 5 * H, "steps"), act(MON + 2 * H, "trip")])["green-starter"]).toBe(MON + 2 * H);
  });

  it("Low-Carbon Foodie at the 10th low-carbon meal", () => {
    const meals = Array.from({ length: 10 }, (_, i) => act(MON + i * H, "meal", { low_carbon: 1 }));
    expect(earned(meals.slice(0, 9))["low-carbon-foodie"]).toBeNull();
    expect(earned(meals)["low-carbon-foodie"]).toBe(MON + 9 * H);
  });

  it("Zero-Waste Hero at the 10th BYO", () => {
    const byo = Array.from({ length: 10 }, (_, i) => act(MON + i * H, "byo"));
    expect(earned(byo)["zero-waste-hero"]).toBe(MON + 9 * H);
  });

  it("Campus Walker needs 20 km of walks within one SG week", () => {
    const walk = (at: number, km: number) => act(at, "trip", { detail: { mode: "walk", distance_km: km } });
    expect(earned([walk(MON + H, 12), walk(MON + DAY, 8)])["campus-walker"]).toBe(MON + DAY);
    // 12 km last week + 12 km this week: not one week
    expect(earned([walk(MON - DAY, 12), walk(MON + H, 12)])["campus-walker"]).toBeNull();
    // car km never count
    expect(earned([act(MON + H, "trip", { detail: { mode: "car", distance_km: 30 } })])["campus-walker"]).toBeNull();
  });

  it("Carbon Champion is earned when the championship week ends", () => {
    expect(earned([], MON - 7 * DAY)["carbon-champion"]).toBe(MON);
    expect(earned([], null)["carbon-champion"]).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run test/streak.test.ts test/badges.test.ts`
Expected: FAIL, "Cannot find module"

- [ ] **Step 3: Implement**

`src/worker/lib/streak.ts`:
```ts
import { sgDayStart } from "./time";

const DAY = 86_400_000;

/** Consecutive SG days with activity, ending today (or yesterday if nothing is logged yet today). */
export function streak(times: number[], now: number): number {
  const days = new Set(times.filter((t) => t <= now).map(sgDayStart));
  let d = sgDayStart(now);
  if (!days.has(d)) d -= DAY;
  let n = 0;
  while (days.has(d)) {
    n++;
    d -= DAY;
  }
  return n;
}
```

`src/worker/lib/badges.ts`:
```ts
import type { Act } from "./missions";
import { sgWeekStart } from "./time";

const DAY = 86_400_000;

export const BADGES = [
  { id: "green-starter", name: "Green Starter", rule: "Log your first action" },
  { id: "low-carbon-foodie", name: "Low-Carbon Foodie", rule: "Eat 10 low-carbon meals" },
  { id: "campus-walker", name: "Campus Walker", rule: "Walk 20 km of campus trips in one week" },
  { id: "zero-waste-hero", name: "Zero-Waste Hero", rule: "Bring your own cup or container 10 times" },
  { id: "carbon-champion", name: "Carbon Champion", rule: "Top last week's leaderboard" },
];

export type BadgeState = { id: string; name: string; rule: string; earned_at: number | null };

function nth(acts: Act[], pred: (a: Act) => boolean, n: number): number | null {
  let seen = 0;
  for (const a of acts) if (pred(a) && ++seen === n) return a.created_at;
  return null;
}

function walkerAt(acts: Act[]): number | null {
  const km = new Map<number, number>();
  for (const a of acts) {
    if (a.type !== "trip" || a.detail.mode !== "walk") continue;
    const w = sgWeekStart(a.created_at);
    const total = (km.get(w) ?? 0) + (Number(a.detail.distance_km) || 0);
    km.set(w, total);
    if (total >= 20) return a.created_at;
  }
  return null;
}

export function badgeStates(acts: Act[], championOfWeek: number | null): BadgeState[] {
  const sorted = [...acts].sort((a, b) => a.created_at - b.created_at);
  const at: Record<string, number | null> = {
    "green-starter": sorted[0]?.created_at ?? null,
    "low-carbon-foodie": nth(sorted, (a) => a.type === "meal" && a.low_carbon === 1, 10),
    "campus-walker": walkerAt(sorted),
    "zero-waste-hero": nth(sorted, (a) => a.type === "byo", 10),
    "carbon-champion": championOfWeek == null ? null : championOfWeek + 7 * DAY,
  };
  return BADGES.map((b) => ({ ...b, earned_at: at[b.id] }));
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run test/streak.test.ts test/badges.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/worker/lib/streak.ts src/worker/lib/badges.ts test/streak.test.ts test/badges.test.ts
git commit -m "feat(lib): day streak and badges computed from activity"
```

---

### Task 3: Ranking

**Files:**
- Create: `src/worker/lib/leaderboard.ts`, `test/leaderboard.test.ts`

**Interfaces:**
- Consumes: `Act`, `missionPoints` (Task 1)
- Produces:
  - `type Entry = { user_id: string; display_name: string; points: number }`
  - `type Ranked = Entry & { rank: number }`
  - `rank(entries: Entry[]): Ranked[]`: drops zero-point entries; standard competition ranking (1, 2, 2, 4); ties broken by name for display
  - `periodPoints(acts: Act[], from: number, to: number): number`: activity points in range plus `missionPoints`

- [ ] **Step 1: Write the failing test** `test/leaderboard.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { periodPoints, rank } from "../src/worker/lib/leaderboard";

const e = (id: string, points: number) => ({ user_id: id, display_name: id.toUpperCase(), points });

describe("rank", () => {
  it("orders by points and shares ranks on ties (1, 2, 2, 4)", () => {
    expect(rank([e("c", 50), e("a", 90), e("d", 10), e("b", 50)]).map((r) => [r.user_id, r.rank])).toEqual([
      ["a", 1], ["b", 2], ["c", 2], ["d", 4],
    ]);
  });
  it("drops students with no points", () => {
    expect(rank([e("a", 0), e("b", 5)]).map((r) => r.user_id)).toEqual(["b"]);
  });
  it("handles an empty week", () => expect(rank([])).toEqual([]));
});

describe("periodPoints", () => {
  const MON = Date.UTC(2026, 8, 27, 16, 0);
  it("adds activity points and mission bonuses inside the range", () => {
    const acts = [
      { created_at: MON + 1000, type: "meal", low_carbon: 1, points: 20, detail: {} },
      { created_at: MON - 1000, type: "meal", low_carbon: 1, points: 20, detail: {} },
    ];
    // this week's meal: +20 activity, +20 daily mission
    expect(periodPoints(acts, MON, MON + 7 * 86_400_000)).toBe(40);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/leaderboard.test.ts`
Expected: FAIL, "Cannot find module"

- [ ] **Step 3: Implement** `src/worker/lib/leaderboard.ts`

```ts
import { missionPoints, type Act } from "./missions";

export type Entry = { user_id: string; display_name: string; points: number };
export type Ranked = Entry & { rank: number };

export function rank(entries: Entry[]): Ranked[] {
  const sorted = entries
    .filter((e) => e.points > 0)
    .sort((a, b) => b.points - a.points || a.display_name.localeCompare(b.display_name));
  let prevPoints = -1;
  let prevRank = 0;
  return sorted.map((e, i) => {
    if (e.points !== prevPoints) {
      prevRank = i + 1;
      prevPoints = e.points;
    }
    return { ...e, rank: prevRank };
  });
}

export function periodPoints(acts: Act[], from: number, to: number): number {
  const activity = acts.reduce((n, a) => (a.created_at >= from && a.created_at < to ? n + a.points : n), 0);
  return activity + missionPoints(acts, from, to);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run test/leaderboard.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/worker/lib/leaderboard.ts test/leaderboard.test.ts
git commit -m "feat(lib): weekly ranking with shared ranks"
```

---

### Task 4: Seed mission and badge definitions

**Files:**
- Modify: `seed/sql.ts`, `test/seed.test.ts`

**Interfaces:**
- Consumes: `MISSIONS` (Task 1), `BADGES` (Task 2)
- Produces: the `missions` table with 6 rows and the `badges` table with 5 rows, both upserted on re-seed.

- [ ] **Step 1: Write the failing test** (append inside the `describe("seed")` block in `test/seed.test.ts`)

```ts
  it("seeds the six missions and five badges", () => {
    const { raw } = seeded();
    expect(raw.prepare("SELECT id, points, period FROM missions ORDER BY id").all()).toEqual([
      { id: "daily-low-meal", points: 20, period: "daily" },
      { id: "daily-walk", points: 20, period: "daily" },
      { id: "weekly-all", points: 50, period: "weekly" },
      { id: "weekly-byo", points: 80, period: "weekly" },
      { id: "weekly-low-meals", points: 100, period: "weekly" },
      { id: "weekly-steps", points: 100, period: "weekly" },
    ]);
    expect((raw.prepare("SELECT COUNT(*) AS n FROM badges").get() as any).n).toBe(5);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/seed.test.ts`
Expected: FAIL (the rows array is empty)

- [ ] **Step 3: Implement.** In `seed/sql.ts`, add the imports:
```ts
import { BADGES } from "../src/worker/lib/badges.ts";
import { MISSIONS } from "../src/worker/lib/missions.ts";
```
and, right after the routes loop in `buildSeedSql`:
```ts
  for (const m of MISSIONS) {
    out.push(upsert("missions", { id: m.id, name: m.name, category: m.category, metric: m.metric, target: m.target, points: m.points, period: m.period }, ["id"], ["name", "category", "metric", "target", "points", "period"]));
  }
  for (const b of BADGES) out.push(upsert("badges", { ...b }, ["id"], ["name", "rule"]));
```

`missions.ts` and `badges.ts` import `./time` without a `.ts` extension. Node runs `seed/build-sql.ts` directly and needs explicit extensions, so change those imports to `./time.ts` (plus `./missions.ts` inside `badges.ts`). Vite and Vitest accept both forms. Also add `"allowImportingTsExtensions": true` to `tsconfig.worker.json` `compilerOptions`; it already has `noEmit`, so this is allowed. Without it, `npm run typecheck` rejects the `.ts` extension.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run && npm run typecheck && node seed/build-sql.ts | grep -c "INTO missions"`
Expected: all tests PASS, no type errors, and the count is `6`.

- [ ] **Step 5: Commit**

```bash
git add seed/sql.ts src/worker/lib/missions.ts src/worker/lib/badges.ts tsconfig.worker.json test/seed.test.ts
git commit -m "feat(seed): mission and badge definitions"
```

---

### Task 5: Missions and leaderboard API, mission bonuses in the summary

**Files:**
- Create: `src/worker/acts.ts`, `src/worker/routes/progress.ts`, `test/progress.test.ts`
- Modify: `src/worker/app.ts`, `src/worker/routes/me.ts`, `test/me.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3, `requireRole`, `sgWeekStart`
- Produces:
  - `loadActs(db, opts: { userId?: string; from?: number }): Promise<(Act & { user_id: string })[]>`: students only
  - `standings(db, from, to): Promise<Ranked[]>`
  - `GET /api/missions` → `{ streak: number, daily: MissionState[], weekly: MissionState[], badges: BadgeState[] }`
  - `GET /api/leaderboard` → `{ top: { rank, display_name, points, me: boolean }[] (≤ 20), me: { rank: number | null, points: number } }`
  - `/api/me/summary`: `points_week` and `points_total` now include mission bonuses

- [ ] **Step 1: Write the failing tests**

`test/progress.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { sgWeekStart } from "../src/worker/lib/time";
import { setup as baseSetup } from "./helpers/setup";

// Persona history can fall inside the current week depending on the weekday the seed ran;
// remove it so rankings here depend only on what each test inserts.
async function setup() {
  const ctx = await baseSetup();
  ctx.raw.exec("DELETE FROM activities WHERE id LIKE 'seed-%'");
  return ctx;
}

async function student(ctx: Awaited<ReturnType<typeof setup>>, name = "Tester") {
  return (await ctx.req("/api/session", { body: { display_name: name } })).body.user.id as string;
}
function add(ctx: any, uid: string, id: string, type: string, extra: { low?: number; points?: number; detail?: object; at?: number } = {}) {
  ctx.raw.exec(
    `INSERT INTO activities (id,user_id,category,type,points,verified,source,low_carbon,detail_json,created_at) VALUES
     ('${id}','${uid}','food','${type}',${extra.points ?? 0},1,'qr',${extra.low ?? "NULL"},'${JSON.stringify(extra.detail ?? {})}',${extra.at ?? Date.now() - 1000})`,
  );
}

describe("GET /api/missions", () => {
  it("is all zero and locked for a new student", async () => {
    const ctx = await setup();
    const uid = await student(ctx);
    const b = (await ctx.req("/api/missions", { as: uid })).body;
    expect(b.streak).toBe(0);
    expect(b.daily).toHaveLength(2);
    expect(b.weekly).toHaveLength(4);
    expect([...b.daily, ...b.weekly].every((m: any) => m.progress === 0 && !m.completed)).toBe(true);
    expect(b.badges.every((x: any) => x.earned_at === null)).toBe(true);
  });

  it("reflects today's activity, streak and first badge", async () => {
    const ctx = await setup();
    const uid = await student(ctx);
    add(ctx, uid, "m1", "meal", { low: 1 });
    await ctx.req("/api/trips", { as: uid, body: { from_id: "hive", to_id: "north-spine", mode: "walk" } });
    const b = (await ctx.req("/api/missions", { as: uid })).body;
    expect(b.daily.every((m: any) => m.completed)).toBe(true);
    expect(b.streak).toBe(1);
    expect(b.badges.find((x: any) => x.id === "green-starter").earned_at).not.toBeNull();
  });

  it("awards Carbon Champion to last week's top student", async () => {
    const ctx = await setup();
    const uid = await student(ctx, "Zed");
    add(ctx, uid, "big", "meal", { points: 999, at: sgWeekStart(Date.now()) - 86_400_000 });
    const b = (await ctx.req("/api/missions", { as: uid })).body;
    expect(b.badges.find((x: any) => x.id === "carbon-champion").earned_at).toBe(sgWeekStart(Date.now()));
  });

  it("is student-only", async () => {
    const ctx = await setup();
    expect((await ctx.req("/api/missions", { as: "u-seller-econ" })).status).toBe(403);
  });
});

describe("GET /api/leaderboard", () => {
  it("ranks this week's students by activity plus mission points", async () => {
    const ctx = await setup();
    const a = await student(ctx, "Ann");
    const b = await student(ctx, "Ben");
    add(ctx, a, "a1", "meal", { low: 1, points: 20 }); // +20 activity, +20 daily mission
    add(ctx, b, "b1", "meal", { low: 0, points: 0 });
    const res = await ctx.req("/api/leaderboard", { as: a });
    expect(res.status).toBe(200);
    expect(res.body.top[0]).toEqual({ rank: 1, display_name: "Ann", points: 40, me: true });
    expect(res.body.top.find((r: any) => r.display_name === "Ben")).toBeUndefined();
    expect(res.body.me).toEqual({ rank: 1, points: 40 });
  });

  it("gives a zero-point student rank null and never lists sellers or admins", async () => {
    const ctx = await setup();
    const a = await student(ctx);
    add(ctx, "u-seller-econ", "s1", "meal", { points: 500 });
    const res = await ctx.req("/api/leaderboard", { as: a });
    expect(res.body.me).toEqual({ rank: null, points: 0 });
    expect(res.body.top.some((r: any) => r.display_name === "Economy Rice seller")).toBe(false);
  });

  it("returns at most 20 rows but still ranks me outside them", async () => {
    const ctx = await setup();
    for (let i = 0; i < 22; i++) {
      const id = `u-bulk-${i}`;
      ctx.raw.exec(`INSERT INTO users (id,display_name,role,created_at) VALUES ('${id}','Bulk ${String(i).padStart(2, "0")}','student',0)`);
      add(ctx, id, `bulk-${i}`, "meal", { points: 100 + i });
    }
    const me = await student(ctx, "Last");
    add(ctx, me, "mine", "meal", { points: 1 });
    const res = await ctx.req("/api/leaderboard", { as: me });
    expect(res.body.top).toHaveLength(20);
    expect(res.body.me).toEqual({ rank: 23, points: 1 });
  });
});
```

Add to `test/me.test.ts` (inside `describe("GET /api/me/summary")`):
```ts
  it("counts mission bonuses once in this week's and total points", async () => {
    const { req, raw } = await setup();
    const at = Date.now() - 1000;
    const ins = (id: string, type: string, low: string, detail = "{}") =>
      raw.exec(`INSERT INTO activities (id,user_id,category,type,points,verified,source,low_carbon,detail_json,created_at) VALUES ('${id}','u-dana','food','${type}',0,1,'qr',${low},'${detail}',${at})`);
    ins("m1", "meal", "1");
    ins("m2", "meal", "1");
    ins("m3", "meal", "1");
    ins("b1", "byo", "NULL");
    ins("s1", "steps", "NULL", '{"steps":3000}');
    ins("s2", "steps", "NULL", '{"steps":2500}');
    const b = (await req("/api/me/summary", { as: "u-dana" })).body;
    // daily low meal +20; weekly meals +100, steps +100, byo +80, all +50
    expect(b.points_week).toBe(350);
    expect(b.points_total).toBe(350);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run test/progress.test.ts test/me.test.ts`
Expected: FAIL (404s, and `points_week` is 0)

- [ ] **Step 3: Implement**

`src/worker/acts.ts`:
```ts
import { rank, periodPoints, type Ranked } from "./lib/leaderboard";
import type { Act } from "./lib/missions";

type Row = { user_id: string; created_at: number; type: string; low_carbon: number | null; points: number; detail_json: string };

/** Student activity as pure-module input. */
export async function loadActs(db: D1Database, opts: { userId?: string; from?: number } = {}): Promise<(Act & { user_id: string })[]> {
  const { results } = await db
    .prepare(
      `SELECT a.user_id, a.created_at, a.type, a.low_carbon, a.points, a.detail_json
       FROM activities a JOIN users u ON u.id = a.user_id
       WHERE u.role = 'student' AND (?1 IS NULL OR a.user_id = ?1) AND a.created_at >= ?2`,
    )
    .bind(opts.userId ?? null, opts.from ?? 0)
    .all<Row>();
  return results.map(({ detail_json, ...r }) => ({ ...r, detail: JSON.parse(detail_json || "{}") }));
}

/** Ranked students for [from, to). */
export async function standings(db: D1Database, from: number, to: number): Promise<Ranked[]> {
  const [acts, users] = await Promise.all([
    loadActs(db, { from }),
    db.prepare("SELECT id, display_name FROM users WHERE role = 'student'").all<{ id: string; display_name: string }>(),
  ]);
  const byUser = new Map<string, Act[]>();
  for (const a of acts) if (a.created_at < to) byUser.set(a.user_id, [...(byUser.get(a.user_id) ?? []), a]);
  return rank(users.results.map((u) => ({ user_id: u.id, display_name: u.display_name, points: periodPoints(byUser.get(u.id) ?? [], from, to) })));
}
```

`src/worker/routes/progress.ts`:
```ts
import { Hono } from "hono";
import { loadActs, standings } from "../acts";
import type { AppEnv } from "../env";
import { badgeStates } from "../lib/badges";
import { currentMissions } from "../lib/missions";
import { streak } from "../lib/streak";
import { sgWeekStart } from "../lib/time";
import { requireRole } from "../session";

export const progress = new Hono<AppEnv>();
const student = requireRole("student");
const WEEK = 7 * 86_400_000;

progress.get("/missions", student, async (c) => {
  const db = c.env.DB;
  const uid = c.get("user")!.id;
  const now = Date.now();
  const thisWeek = sgWeekStart(now);
  const [acts, lastWeek] = await Promise.all([loadActs(db, { userId: uid }), standings(db, thisWeek - WEEK, thisWeek)]);
  const champion = lastWeek.some((r) => r.rank === 1 && r.user_id === uid) ? thisWeek - WEEK : null;
  return c.json({
    streak: streak(acts.map((a) => a.created_at), now),
    ...currentMissions(acts, now),
    badges: badgeStates(acts, champion),
  });
});

progress.get("/leaderboard", student, async (c) => {
  const uid = c.get("user")!.id;
  const now = Date.now();
  const ranked = await standings(c.env.DB, sgWeekStart(now), now + 1);
  const mine = ranked.find((r) => r.user_id === uid);
  return c.json({
    top: ranked.slice(0, 20).map((r) => ({ rank: r.rank, display_name: r.display_name, points: r.points, me: r.user_id === uid })),
    me: mine ? { rank: mine.rank, points: mine.points } : { rank: null, points: 0 },
  });
});
```

Modify `src/worker/app.ts`: `import { progress } from "./routes/progress";` and `app.route("/", progress);`.

Modify `src/worker/routes/me.ts`:
- add `import { loadActs } from "../acts";` and `import { missionPoints } from "../lib/missions";`
- add `loadActs(db, { userId: uid })` to the `Promise.all` list and destructure it as `myActs`
- in the response, replace the two points lines:

```ts
    points_total: (totals?.total ?? 0) + missionPoints(myActs, 0, Date.now() + 1),
    points_week: (totals?.week ?? 0) + missionPoints(myActs, weekStart, Date.now() + 1),
```

- [ ] **Step 4: Run all tests**

Run: `npx vitest run && npm run typecheck`
Expected: all PASS and no type errors. Existing summary tests that assert exact `points_week` / `points_total` values may now include mission bonuses. Check each failure and correct the expected number by computing the bonus from the missions table above. Don't weaken the assertion.

- [ ] **Step 5: Commit**

```bash
git add src/worker test/progress.test.ts test/me.test.ts
git commit -m "feat(progress): missions, streak, badges and weekly leaderboard API"
```

---

### Task 6: Missions and Ranks screens

**Files:**
- Create: `src/app/screens/Missions.tsx`, `src/app/screens/Ranks.tsx`
- Modify: `src/app/copy.ts`, `test/copy.test.ts`, `src/app/components/TabBar.tsx`, `src/app/App.tsx`, `src/app/styles.css`

**Interfaces:**
- Consumes: `GET /api/missions`, `GET /api/leaderboard` (Task 5)
- Produces: `ordinal(n: number): string` in `copy.ts`

- [ ] **Step 1: Write the failing test** (append to `test/copy.test.ts`)

```ts
import { ordinal } from "../src/app/copy";

describe("ordinal", () => {
  it.each([[1, "1st"], [2, "2nd"], [3, "3rd"], [4, "4th"], [11, "11th"], [12, "12th"], [13, "13th"], [21, "21st"], [22, "22nd"], [101, "101st"]])(
    "%i → %s",
    (n, s) => expect(ordinal(n)).toBe(s),
  );
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/copy.test.ts`
Expected: FAIL (`ordinal` is not a function)

- [ ] **Step 3: Implement `ordinal`** (append to `src/app/copy.ts`)

```ts
export function ordinal(n: number): string {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}
```

Run: `npx vitest run test/copy.test.ts`
Expected: PASS

- [ ] **Step 4: Styles** (append to `src/app/styles.css`, and change `.tabbar button` padding to `10px 16px`)

```css
.tabbar button { padding: 10px 16px; }
.mission { padding: 12px 0; border-bottom: 0.5px solid #dcdad3; }
.mission:last-child { border-bottom: 0; }
.mission .top { display: flex; justify-content: space-between; gap: 12px; font-size: 15px; }
.mission .reward { font-family: var(--serif); color: var(--text-2); }
.mission.done .reward { color: var(--accent); }
.progress { height: 5px; border-radius: 3px; background: #dcdad3; margin-top: 8px; overflow: hidden; }
.progress i { display: block; height: 100%; background: var(--accent); border-radius: 3px; transition: width 500ms ease; }
.badges { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.badge { background: var(--card); border-radius: 16px; padding: 14px; }
.badge.locked { background: transparent; border: 0.5px dashed var(--line); }
.badge .name { font-family: var(--serif); font-size: 17px; }
.badge.locked .name { color: var(--muted); }
.badge .rule { font-size: 12px; color: var(--muted); margin-top: 4px; line-height: 1.4; }
.rank-row { display: flex; align-items: baseline; gap: 14px; padding: 14px 12px; border-bottom: 0.5px solid var(--line); }
.rank-row .pos { font-family: var(--serif); font-size: 18px; width: 28px; color: var(--muted); }
.rank-row .who { flex: 1; font-size: 16px; }
.rank-row .pts { font-family: var(--serif); font-size: 18px; }
.rank-row.me { background: var(--panel); border-radius: 14px; border-bottom-color: transparent; }
```

- [ ] **Step 5: Write `src/app/screens/Missions.tsx`**

```tsx
import { useEffect, useState } from "react";
import { api } from "../api";

type Mission = { id: string; name: string; target: number; points: number; progress: number; completed: boolean };
type Badge = { id: string; name: string; rule: string; earned_at: number | null };
type Data = { streak: number; daily: Mission[]; weekly: Mission[]; badges: Badge[] };

const date = new Intl.DateTimeFormat("en-SG", { day: "numeric", month: "short", timeZone: "Asia/Singapore" });

function List({ title, items }: { title: string; items: Mission[] }) {
  return (
    <div>
      <div className="section-head">{title}</div>
      <div className="panel" style={{ paddingTop: 4, paddingBottom: 4 }}>
        {items.map((m) => (
          <div key={m.id} className={m.completed ? "mission done" : "mission"}>
            <div className="top">
              <span>{m.name}</span>
              <span className="reward">{m.completed ? "Done" : `+${m.points}`}</span>
            </div>
            <div className="progress" aria-label={`${m.progress} of ${m.target}`}>
              <i style={{ width: `${(m.progress / m.target) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Missions() {
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api<Data>("/missions").then(setData).catch(() => setFailed(true));
  }, []);

  if (failed) return <p className="error">Couldn't load missions. Reload to try again.</p>;
  if (!data) return null;
  const earned = data.badges.filter((b) => b.earned_at != null).length;

  return (
    <>
      <div>
        <div className="eyebrow">Missions</div>
        <h1 className="display" style={{ marginTop: 8 }}>
          {data.streak > 0 ? `${data.streak}-day streak.` : "Log anything today to start a streak."}
        </h1>
      </div>
      <List title="Today" items={data.daily} />
      <List title="This week" items={data.weekly} />
      <div>
        <div className="section-head">Badges · {earned} of {data.badges.length}</div>
        <div className="badges" style={{ marginTop: 8 }}>
          {data.badges.map((b) => (
            <div key={b.id} className={b.earned_at != null ? "badge" : "badge locked"}>
              <div className="name">{b.name}</div>
              <div className="rule">{b.earned_at != null ? `Earned ${date.format(b.earned_at)}` : b.rule}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 6: Write `src/app/screens/Ranks.tsx`**

```tsx
import { useEffect, useState } from "react";
import { api } from "../api";
import { ordinal } from "../copy";

type Data = { top: { rank: number; display_name: string; points: number; me: boolean }[]; me: { rank: number | null; points: number } };

export function Ranks() {
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api<Data>("/leaderboard").then(setData).catch(() => setFailed(true));
  }, []);

  if (failed) return <p className="error">Couldn't load the ranking. Reload to try again.</p>;
  if (!data) return null;
  const meListed = data.top.some((r) => r.me);

  return (
    <>
      <div>
        <div className="eyebrow">This week</div>
        <h1 className="display" style={{ marginTop: 8 }}>
          {data.me.rank ? `You're ${ordinal(data.me.rank)} this week.` : "Earn points to join this week's ranking."}
        </h1>
      </div>
      {data.top.length === 0 ? (
        <p className="body">No one has points yet this week. Be the first.</p>
      ) : (
        <div className="list">
          {data.top.map((r, i) => (
            <div key={i} className={r.me ? "rank-row me" : "rank-row"}>
              <span className="pos">{r.rank}</span>
              <span className="who">{r.display_name}</span>
              <span className="pts">{r.points}</span>
            </div>
          ))}
          {!meListed && data.me.rank && (
            <div className="rank-row me">
              <span className="pos">{data.me.rank}</span>
              <span className="who">You</span>
              <span className="pts">{data.me.points}</span>
            </div>
          )}
        </div>
      )}
      <p className="muted">Points from meals, trips, returns and mission bonuses. Resets every Monday.</p>
    </>
  );
}
```

- [ ] **Step 7: Tabs and routes**

`src/app/components/TabBar.tsx`: set
```ts
const TABS = [
  { path: "/", label: "Today" },
  { path: "/log", label: "Log" },
  { path: "/missions", label: "Missions" },
  { path: "/ranks", label: "Ranks" },
];
```

`src/app/App.tsx`: import `Missions` and `Ranks`. Replace the two student route lines with:
```tsx
      {main && student && path === "/log" && <Log />}
      {main && student && path === "/missions" && <Missions />}
      {main && student && path === "/ranks" && <Ranks />}
      {main && student && !["/log", "/missions", "/ranks"].includes(path) && <Home user={me.user} />}
```

- [ ] **Step 8: Build and check in the browser**

Run: `npm run build && npm run typecheck && npx vitest run`
Expected: no errors, all PASS.

Then run `npm run db:local` and start the preview (config `dev`). At 375 px:
1. As Alex, the tab bar shows four tabs and fits without wrapping or horizontal scroll.
2. Missions: the headline is either a streak or the "start a streak" line. Today shows 2 missions with bars, This week shows 4, and badges show "N of 5" with locked ones dashed.
3. Log a walk in the Log tab, then return to Missions: "Walk one campus trip today" shows Done, and the streak is at least 1.
4. Ranks: "You're 1st this week." (or the join line). Your row is highlighted grey. Personas whose points all fall in past weeks aren't listed.
5. Today: points this week includes the +20 walk-mission bonus.

- [ ] **Step 9: Commit**

```bash
git add src/app test/copy.test.ts
git commit -m "feat(app): Missions and Ranks tabs"
```

---

### Task 7: Spec note, live seed and deploy

**Files:**
- Modify: `docs/superpowers/specs/2026-09-29-campus-carbon-app-design.md` (§6)

- [ ] **Step 1: Update spec §6.** Replace the line "Computed on read, not stored: streaks, weekly budget, leaderboard, nudges." with:

```markdown
Computed on read, not stored: missions (progress and completion), streaks, badges, weekly budget, leaderboard, nudges. They are all pure functions of `activities`, so a mission can't pay twice and nothing drifts out of sync. `missions` and `badges` hold the definitions (seeded from code). `user_missions` and `user_badges` stay in the schema but aren't used in the demo. Carbon Champion reflects last week's leaderboard.
```

- [ ] **Step 2: Seed the live database** (mission and badge rows. The seed is conflict-safe, so live data is untouched.)

```bash
npm run seed:sql
npx wrangler d1 execute campus-carbon --remote --file seed/seed.sql
npx wrangler d1 execute campus-carbon --remote --command "SELECT (SELECT COUNT(*) FROM missions) AS missions, (SELECT COUNT(*) FROM badges) AS badges, (SELECT COUNT(*) FROM users WHERE display_name='Simon' AND role='admin') AS simon_admins"
```
Expected: `missions: 6, badges: 5, simon_admins: 3`.

- [ ] **Step 3: Deploy**

Run: `npm run deploy`, then `curl -s https://campus-carbon.stan322.workers.dev/api/health`
Expected: `{"ok":true}`

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-09-29-campus-carbon-app-design.md
git commit -m "docs(spec): missions, streaks, badges and leaderboard computed on read"
```
