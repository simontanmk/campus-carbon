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
