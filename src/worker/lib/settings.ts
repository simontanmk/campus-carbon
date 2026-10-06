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
  ai_daily_max: 20,
};

/** Values below these break claims (a code that expires at once, no claims at all, no AI). */
export const SETTING_MIN: Partial<Record<keyof typeof DEFAULT_SETTINGS, number>> = { token_ttl_sec: 15, rate_daily_max: 1, ai_daily_max: 1 };

export const isSettingKey = (k: string): k is keyof typeof DEFAULT_SETTINGS => Object.hasOwn(DEFAULT_SETTINGS, k);

export type Settings = { [K in keyof typeof DEFAULT_SETTINGS]: number };

export function parseSettings(rows: { key: string; value: string }[]): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  for (const { key, value } of rows) {
    if (!isSettingKey(key)) continue;
    const n = Number(value);
    if (Number.isFinite(n)) out[key] = n;
  }
  return out;
}
