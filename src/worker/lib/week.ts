const DAY = 86_400_000;

export type DayState = "low" | "other" | "none";

/** Monday-first states for the week starting at weekStart (Mon 00:00 SGT). */
export function weekDays(
  acts: { created_at: number; type: string; low_carbon: number | null }[],
  weekStart: number,
): DayState[] {
  const days: DayState[] = Array(7).fill("none");
  for (const a of acts) {
    const i = Math.floor((a.created_at - weekStart) / DAY);
    if (i < 0 || i > 6) continue;
    if (a.type === "meal" && a.low_carbon === 1) days[i] = "low";
    else if (days[i] === "none") days[i] = "other";
  }
  return days;
}
