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
