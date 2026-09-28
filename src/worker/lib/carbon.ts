export type Parts = Record<string, number>;
export type FactorTable = Record<string, number | null>;

export const HIGH_CARBON_PROTEINS: readonly string[] = [
  "poultry", "pork", "beef_herd", "beef_dairy", "fish_farmed",
];

/** kg CO2e for ingredient grams, rounded to 2 dp. null = not estimable. */
export function computeKg(parts: Parts, factors: FactorTable): number | null {
  const keys = Object.keys(parts);
  if (keys.length === 0) return null;
  let total = 0;
  for (const k of keys) {
    const f = factors[k];
    if (f == null) return null;
    total += (parts[k] / 1000) * f;
  }
  return Math.round(total * 100) / 100;
}

/** Low-carbon = no meat, fish or seafood protein (spec §7). */
export function isLowCarbonMeal(parts: Parts): boolean {
  return !Object.keys(parts).some((k) => HIGH_CARBON_PROTEINS.includes(k) && parts[k] > 0);
}
