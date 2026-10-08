-- Every food factor value with its citation, per dataset (spec 2026-10-08-combined-emission-factors-design.md §4).
-- The app reads only `factors` (the combined table); these rows are for provenance and the analysis bounds.
CREATE TABLE factor_sources (
  dataset TEXT NOT NULL CHECK (dataset IN ('sg_ecosperity_2019','owid_poore_2018','owid_luc_2018')),
  key TEXT NOT NULL,
  kg_per_unit REAL NOT NULL,
  source TEXT NOT NULL,
  note TEXT,
  PRIMARY KEY (dataset, key)
);
