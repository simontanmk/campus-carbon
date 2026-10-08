// Food emission factors (spec 2026-10-08-combined-emission-factors-design.md). The app's official table is
// Ecosperity's Singapore values + Poore & Nemecek's land-use-change stage; foods Ecosperity doesn't cover keep
// the OWID total. Two single-source tables (sg_only, owid_only) are kept for analysis only.

export type Entry = { kg: number; source: string; note: string | null };

export const ECOSPERITY = "Ecosperity (2019), Environmental Impact of Key Food Items in Singapore, Annex A";
export const OWID = "Poore & Nemecek (2018) via Our World in Data";
export const OWID_LUC_SRC = "Poore & Nemecek (2018) via Our World in Data, land-use stage (food-emissions-supply-chain)";

export const FOOD_KEYS = ["rice", "wheat", "poultry", "pork", "beef_herd", "beef_dairy", "fish_farmed", "eggs", "tofu", "milk", "coffee", "cane_sugar", "veg"] as const;

/** OWID totals, grapher ghg-per-kg-poore (checked 2026-10-08). */
export const OWID_TOTAL: Record<string, Entry> = {
  rice: { kg: 4.45, source: OWID, note: "Rice" },
  wheat: { kg: 1.57, source: OWID, note: "Wheat & Rye" },
  poultry: { kg: 9.87, source: OWID, note: "Poultry Meat" },
  pork: { kg: 12.31, source: OWID, note: "Pig Meat" },
  beef_herd: { kg: 99.48, source: OWID, note: "Beef (beef herd)" },
  beef_dairy: { kg: 33.3, source: OWID, note: "Beef (dairy herd)" },
  fish_farmed: { kg: 13.63, source: OWID, note: "Fish (farmed)" },
  eggs: { kg: 4.67, source: OWID, note: "Eggs" },
  tofu: { kg: 3.16, source: OWID, note: "Tofu" },
  milk: { kg: 3.15, source: OWID, note: "Milk; proxy for condensed/evaporated milk in kopi" },
  coffee: { kg: 28.53, source: OWID, note: "Coffee" },
  cane_sugar: { kg: 3.2, source: OWID, note: "Cane Sugar" },
  veg: { kg: 0.43, source: OWID, note: "Root Vegetables; proxy for all vegetables" },
};

/** Ecosperity import-weighted averages (Singapore 2018 import mix), Annex A. */
export const SG: Record<string, Entry> = {
  rice: { kg: 2.57, source: ECOSPERITY, note: "p. 51, milled rice" },
  wheat: { kg: 0.72, source: ECOSPERITY, note: "p. 52" },
  poultry: { kg: 3.54, source: ECOSPERITY, note: "p. 43, chicken" },
  pork: { kg: 12.77, source: ECOSPERITY, note: "p. 42 (the p. 17 summary chart shows 12.0)" },
  beef_herd: { kg: 24.41, source: ECOSPERITY, note: "p. 40; one beef figure, mostly grass-fed from Brazil, Australia, NZ" },
  beef_dairy: { kg: 24.41, source: ECOSPERITY, note: "p. 40; same single beef figure" },
  fish_farmed: { kg: 6.28, source: ECOSPERITY, note: "p. 46, fish average (catfish, salmon, mackerel); local aquaculture alone 3.67" },
  eggs: { kg: 3.08, source: ECOSPERITY, note: "p. 45" },
  veg: { kg: 0.82, source: ECOSPERITY, note: "p. 50, other vegetables average; leafy vegetables 0.40 (p. 49)" },
};

/** Reference only: Ecosperity items no menu item uses yet (not in the live table). */
export const SG_REFERENCE: Record<string, Entry> = {
  duck: { kg: 4.21, source: ECOSPERITY, note: "p. 44; OWID has no duck" },
  mutton: { kg: 16.47, source: ECOSPERITY, note: "p. 41" },
  seafood: { kg: 5.72, source: ECOSPERITY, note: "p. 47, shrimp, crab, squid; shrimp alone 6.25; OWID has no prawn land-use row" },
  fruit: { kg: 0.42, source: ECOSPERITY, note: "p. 48" },
};

/** OWID land-use-change stage, kg CO2e per kg, grapher food-emissions-supply-chain (checked 2026-10-08). */
export const OWID_LUC: Record<string, Entry> = {
  rice: { kg: -0.02187964, source: OWID_LUC_SRC, note: "Rice" },
  wheat: { kg: 0.09713003, source: OWID_LUC_SRC, note: "Wheat & Rye" },
  poultry: { kg: 3.5084288, source: OWID_LUC_SRC, note: "Poultry Meat" },
  pork: { kg: 2.2440686, source: OWID_LUC_SRC, note: "Pig Meat" },
  beef_herd: { kg: 23.237535, source: OWID_LUC_SRC, note: "Beef (beef herd)" },
  beef_dairy: { kg: 23.237535, source: OWID_LUC_SRC, note: "Beef (beef herd): Singapore's beef is mostly grass-fed" },
  fish_farmed: { kg: 1.1947172, source: OWID_LUC_SRC, note: "Fish (farmed)" },
  eggs: { kg: 0.71038127, source: OWID_LUC_SRC, note: "Eggs" },
  veg: { kg: 0.001180576, source: OWID_LUC_SRC, note: "Other Vegetables" },
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function combineFactors(sg: Record<string, number>, luc: Record<string, number>, owid: Record<string, number>) {
  const out: Record<string, { kg: number; basis: "sg+luc" | "owid" }> = {};
  for (const k of Object.keys(owid)) {
    if (k in sg) {
      if (!(k in luc)) throw new Error(`no land-use value for ${k}`);
      out[k] = { kg: r2(sg[k] + luc[k]), basis: "sg+luc" };
    } else out[k] = { kg: owid[k], basis: "owid" };
  }
  return out;
}

const kgOf = (t: Record<string, Entry>) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.kg]));

export const COMBINED = combineFactors(kgOf(SG), kgOf(OWID_LUC), kgOf(OWID_TOTAL));
export const SG_ONLY: Record<string, number> = { ...kgOf(OWID_TOTAL), ...kgOf(SG) };
export const OWID_ONLY: Record<string, number> = kgOf(OWID_TOTAL);

export const COMBINED_SOURCE = `${ECOSPERITY} + land-use change from ${OWID}`;

/** factor_sources rows: every dataset value with its citation. */
export function factorSourceRows() {
  const rows: { dataset: string; key: string; kg_per_unit: number; source: string; note: string | null }[] = [];
  const add = (dataset: string, t: Record<string, Entry>) => {
    for (const [key, e] of Object.entries(t)) rows.push({ dataset, key, kg_per_unit: e.kg, source: e.source, note: e.note });
  };
  add("sg_ecosperity_2019", { ...SG, ...SG_REFERENCE });
  add("owid_poore_2018", OWID_TOTAL);
  add("owid_luc_2018", OWID_LUC);
  return rows;
}
