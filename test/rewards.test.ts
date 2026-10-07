import { describe, expect, it } from "vitest";
import { earnedPoints } from "../src/worker/points";
import { setup } from "./helpers/setup";

describe("earnedPoints", () => {
  it("equals Today's lifetime points, mission bonuses included", async () => {
    const ctx = await setup(); // seeded personas have history with mission bonuses
    for (const uid of ["u-alex", "u-bea", "u-chen"]) {
      const today = (await ctx.req("/api/me/summary", { as: uid })).body.points_total;
      expect(today).toBeGreaterThan(0);
      expect(await earnedPoints(ctx.env.DB, uid)).toBe(today);
    }
  });
});
