import { bandOf } from "./carbon.ts";
import type { Settings } from "./settings.ts";

/** Stall meal points by band: green points_meal_low_carbon, amber points_meal_amber, red 0. Drinks earn 0. */
export function stallClaimPoints(
  item: { kind: "meal" | "drink"; kg_co2e: number | null; points: number | null },
  s: Settings,
): number {
  if (item.points != null) return item.points;
  if (item.kind !== "meal") return 0;
  const band = bandOf(item.kg_co2e);
  return band === "green" ? s.points_meal_low_carbon : band === "amber" ? s.points_meal_amber : 0;
}

export function byoPoints(s: Settings): number {
  return s.points_byo;
}
