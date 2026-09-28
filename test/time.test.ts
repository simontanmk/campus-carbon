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
