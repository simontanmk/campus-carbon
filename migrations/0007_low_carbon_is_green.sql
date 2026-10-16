-- Low-carbon now means the green band, kg CO2e <= 0.7 (spec 2026-10-16-band-scoring-design.md).
-- Re-derive the stored flags from kg; points already awarded are not touched.
UPDATE items SET low_carbon = CASE WHEN kind = 'meal' AND kg_co2e IS NOT NULL AND kg_co2e <= 0.7 THEN 1 ELSE 0 END;
UPDATE activities SET low_carbon = CASE WHEN kg_co2e IS NOT NULL AND kg_co2e <= 0.7 THEN 1 ELSE 0 END WHERE type = 'meal';
