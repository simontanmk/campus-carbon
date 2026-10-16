# Band scoring: green, amber, red

Date: 2026-10-16. Status: approved in chat ("A", then "go ahead").

## Rule
- A meal's band comes from its kg CO₂e under the official (combined) factor table: **green ≤ 0.7, amber ≤ 1.4, red above**. Thresholds are fixed in code (`bandOf`, `src/worker/lib/carbon.ts`).
- **Stall meal points:** green `points_meal_low_carbon` (20), amber `points_meal_amber` (10, new setting), red 0. An item's own points override still wins. Drinks: no band, 0 points.
- **Low-carbon = green**, everywhere: missions, the Low-Carbon Foodie badge, low-carbon share, kg saved, swap tip, insights. The old "no meat or fish" rule (`isLowCarbonMeal`) is removed.
- **Photo meals:** green +5 (live AI only), amber and red 0.

## Data
- Migration `0007_low_carbon_is_green.sql` re-derives `items.low_carbon` and meal `activities.low_carbon` from kg. `buildFactorsSql` runs the same statements after any factor change.
- Points already awarded are never changed.

## Display
- `band` is returned with claim results, stall items, admin items, the photo estimate and Today's recent list.
- Shown on the seller's item buttons, the claim and tap result ("Amber meal +10"), Recent, the photo estimate, and the admin menu lists. Colours: green `--accent`, amber `--amber`, red `--danger`.

## Not changed
- "kg saved" keeps its formula (menu average − meal kg, for green meals). Reworking it is a separate item.
