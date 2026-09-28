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
