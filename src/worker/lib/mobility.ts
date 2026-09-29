import type { Settings } from "./settings";

export type Mode = "walk" | "shuttle" | "car";
export type TripOption = { mode: Mode; minutes: number; kg_co2e: number | null; points: number };

const mins = (m: number) => Math.max(1, Math.round(m));
const kg = (km: number, factor: number | null) => (factor == null ? null : Math.round(km * factor * 100) / 100);

export function tripOptions(
  route: { distance_km: number; walk_min: number; shuttle_min: number | null; car_min: number | null },
  factors: { shuttle: number | null; car: number | null },
  s: Settings,
): TripOption[] {
  const out: TripOption[] = [{ mode: "walk", minutes: mins(route.walk_min), kg_co2e: 0, points: s.points_walk_trip }];
  if (route.shuttle_min != null) {
    out.push({ mode: "shuttle", minutes: mins(route.shuttle_min), kg_co2e: kg(route.distance_km, factors.shuttle), points: s.points_shuttle_trip });
  }
  if (route.car_min != null) {
    out.push({ mode: "car", minutes: mins(route.car_min), kg_co2e: kg(route.distance_km, factors.car), points: 0 });
  }
  return out;
}
