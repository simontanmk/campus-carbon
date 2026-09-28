export const DEFAULT_SETTINGS = {
  points_meal_low_carbon: 20,
  points_byo: 15,
  points_photo_low_carbon: 5,
  points_walk_trip: 10,
  points_shuttle_trip: 5,
  points_container_return: 5,
  self_reported_daily_cap: 30,
  rate_stall_window_min: 10,
  rate_daily_max: 5,
  token_ttl_sec: 90,
};

export type Settings = { [K in keyof typeof DEFAULT_SETTINGS]: number };

export function parseSettings(rows: { key: string; value: string }[]): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  for (const { key, value } of rows) {
    if (!(key in out)) continue;
    const n = Number(value);
    if (Number.isFinite(n)) out[key as keyof Settings] = n;
  }
  return out;
}
