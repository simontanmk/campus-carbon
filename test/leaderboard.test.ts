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
      { created_at: MON + 1000, type: "meal", low_carbon: 1, points: 20, verified: 1, detail: {} },
      { created_at: MON - 1000, type: "meal", low_carbon: 1, points: 20, verified: 1, detail: {} },
    ];
    // this week's meal: +20 activity, +20 daily mission
    expect(periodPoints(acts, MON, MON + 7 * 86_400_000)).toBe(40);
  });
});
