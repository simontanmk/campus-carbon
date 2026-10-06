import { sgDayStart } from "./time.ts";

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
