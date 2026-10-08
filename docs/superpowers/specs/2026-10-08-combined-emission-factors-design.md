# Combined emission factors: Singapore data plus land-use change

Date: 2026-10-08. Status: approved in chat ("commit as in apply").

## 1. Decision

The app's official food factors become **Ecosperity (2019) Singapore values + the land-use-change stage from Poore & Nemecek (2018) via OWID**. Foods the Singapore study doesn't cover keep their full OWID value. Everything students, sellers, admins and the projector see uses this one table, and **every past meal is recalculated with it**, so history is never mixed.

Two single-source versions are kept for analysis only, never for points, budgets or anything a student sees:
- `sg_only`: Ecosperity values, OWID where Ecosperity has none.
- `owid_only`: full OWID values (the old table).

## 2. Sources (checked 2026-10-08)

**Ecosperity, Environmental Impact of Key Food Items in Singapore (Oct 2019).** Import-weighted averages for Singapore's 2018 import mix, from Annex A:
- beef 24.41 (p. 40), mutton 16.47 (p. 41), pork 12.77 (p. 42; the p. 17 summary chart rounds it to 12.0)
- chicken 3.54 (p. 43), duck 4.21 (p. 44), eggs 3.08 (p. 45)
- fish 6.28 (p. 46; local aquaculture alone 3.67), other seafood 5.72 (p. 47), fruit 0.42 (p. 48)
- leafy vegetables 0.40 (p. 49), other vegetables 0.82 (p. 50), rice 2.57 (p. 51), wheat 0.72 (p. 52)

Boundary (p. 11): production, processing (including packaging) and transport, with food loss along the supply chain. Retail, cooking and waste are excluded. Land-use change is not mentioned. Method: ISO 14040/44, with CO₂, CH₄ and N₂O.

**Poore & Nemecek (2018) via OWID:**
- totals: grapher `ghg-per-kg-poore`
- per-stage breakdown: grapher `food-emissions-supply-chain` (stages: land use, farm, animal feed, processing, transport, retail, packaging, losses)

## 3. Combination rule

`combined[key] = round(sg[key] + luc[key], 2)` when Ecosperity covers the key; otherwise `owid[key]`.

Only land-use change is added. Packaging and losses are already inside Ecosperity's boundary, and retail is excluded on purpose, so it stays out.

| key | Ecosperity | OWID land use | combined | OWID total |
|---|---|---|---|---|
| rice | 2.57 | −0.02 (Rice) | 2.55 | 4.45 |
| wheat | 0.72 | 0.10 (Wheat & Rye) | 0.82 | 1.57 |
| poultry | 3.54 | 3.51 (Poultry Meat) | 7.05 | 9.87 |
| pork | 12.77 | 2.24 (Pig Meat) | 15.01 | 12.31 |
| beef_herd | 24.41 | 23.24 (Beef, beef herd) | 47.65 | 99.48 |
| beef_dairy | 24.41 | 23.24 (Beef, beef herd) | 47.65 | 33.3 |
| fish_farmed | 6.28 | 1.19 (Fish, farmed) | 7.47 | 13.63 |
| eggs | 3.08 | 0.71 (Eggs) | 3.79 | 4.67 |
| veg | 0.82 (other vegetables) | 0.00 (Other Vegetables) | 0.82 | 0.43 |
| tofu, milk, coffee, cane_sugar | none | none | OWID total | 3.16, 3.15, 28.53, 3.2 |

- **Beef:** Ecosperity has one beef figure, mostly grass-fed beef from Brazil, Australia and New Zealand (p. 17), so both beef keys use the beef-herd land-use value. Beef hor fun's parts change from `beef_dairy` to `beef_herd` to match, and its 5.7 `kg_override` (a midpoint between the two OWID beefs) is removed.
- **Not in the live table:** duck, mutton, seafood and fruit are recorded in `factor_sources` for reference only. No menu item uses them, OWID has no duck and no prawn land-use row, and adding them would change the AI prompt and the low-carbon rule.

## 4. Data

- Migration `0006_factor_sources.sql`: table `factor_sources (dataset, key, kg_per_unit, source, note, PRIMARY KEY (dataset, key))`. The three datasets are `sg_ecosperity_2019`, `owid_poore_2018` and `owid_luc_2018`.
- `factors` (used by the app) holds the combined food values, plus transport, which is unchanged. Its `source` names both studies, or OWID alone for fallbacks.
- Single source of truth: `seed/factors.ts`. It defines the three datasets and derives the combined table and both bounds.

## 5. Recalculating the past

`buildFactorsSql()` emits:
1. the `factors` and `factor_sources` upserts
2. `items.kg_co2e` recomputed in SQL from `parts_json` × `factors`, rounded to 2 dp. NULL when there are no parts or a factor is missing.
3. stall meals and drinks: `activities.kg_co2e` = their item's new kg
4. photo meals: `activities.kg_co2e` recomputed from `detail_json.parts`
5. `DELETE FROM summaries` (cached weekly nudges quote old kg)

Trips, BYO and returns are untouched. Points and `low_carbon` don't depend on kg, so they don't change. Budgets, insights, recap and `/impact` are computed on read, so they follow automatically.

Commands: `npm run factors:apply:local` and `npm run factors:apply` (remote). Re-running is safe.

## 6. Analysis outputs

- Activities CSV: new columns `kg_sg_only` and `kg_owid_only` for food rows, computed from the same parts.
- `docs/factor-comparison.md`: per dish, kg and three-band label (green ≤ 0.7, amber ≤ 1.4, red above) under owid_only, sg_only and combined, plus each menu average. The bands are for the comparison only; the app's scoring is unchanged.
- The pasted request also asked for bands "re-centred on each dataset's menu average". That is left out: scaling both thresholds by the ratio of averages pushes the egg and tofu dishes into amber, which defeats the purpose. Bands that follow the data belong with the separate scoring change.

## 7. Testing

- combination rule, fallbacks, rounding, the two bounds
- band function and boundaries
- SQL recompute: matches `computeKg` for every seeded item; after a factor change, items, stall-meal activities and photo activities follow, trips stay the same, summaries are cleared
- CSV bound columns
