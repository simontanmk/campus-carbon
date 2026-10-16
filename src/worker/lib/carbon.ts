export type Parts = Record<string, number>;
export type FactorTable = Record<string, number | null>;

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

export type Band = "green" | "amber" | "red";

/** Three-band label for a meal's kg (spec 2026-10-16-band-scoring-design.md): green ≤ 0.7, amber ≤ 1.4, red above. */
export function bandOf(kg: number | null): Band | null {
  if (kg == null) return null;
  return kg <= 0.7 ? "green" : kg <= 1.4 ? "amber" : "red";
}

/** Low-carbon = a green-band meal, whatever it contains. Drinks are never banded. */
export const isLowCarbon = (kind: string, kg: number | null) => kind === "meal" && bandOf(kg) === "green";

/** A meal's band for display; drinks have none. */
export const mealBand = (kind: string, kg: number | null): Band | null => (kind === "meal" ? bandOf(kg) : null);
