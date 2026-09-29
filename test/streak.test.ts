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
