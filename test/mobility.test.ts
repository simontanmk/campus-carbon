import { describe, expect, it } from "vitest";
import { tripOptions } from "../src/worker/lib/mobility";
import { DEFAULT_SETTINGS } from "../src/worker/lib/settings";

const route = { distance_km: 1.9, walk_min: 25.2, shuttle_min: 9.8, car_min: 4.8 };
const f = { shuttle: 0.0965, car: 0.1705 };

describe("tripOptions", () => {
  it("returns walk, shuttle and car with time, kg and points", () => {
    expect(tripOptions(route, f, DEFAULT_SETTINGS)).toEqual([
      { mode: "walk", minutes: 25, kg_co2e: 0, points: 10 },
      { mode: "shuttle", minutes: 10, kg_co2e: 0.18, points: 5 },
      { mode: "car", minutes: 5, kg_co2e: 0.32, points: 0 },
    ]);
  });
  it("returns null kg when a factor is pending, never 0", () => {
    const opts = tripOptions(route, { shuttle: null, car: 0.1705 }, DEFAULT_SETTINGS);
    expect(opts.find((o) => o.mode === "shuttle")!.kg_co2e).toBeNull();
  });
  it("omits a mode whose time is unknown", () => {
    expect(tripOptions({ ...route, shuttle_min: null }, f, DEFAULT_SETTINGS).map((o) => o.mode)).toEqual(["walk", "car"]);
  });
  it("rounds minutes up to at least 1", () => {
    expect(tripOptions({ distance_km: 0.05, walk_min: 0.4, shuttle_min: 5.1, car_min: 0.2 }, f, DEFAULT_SETTINGS)[0].minutes).toBe(1);
  });
});
