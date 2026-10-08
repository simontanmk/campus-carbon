-- Container returns backed by the BCRS refund receipt (spec 2026-10-08-bcrs-receipt-returns-design.md §6).
-- SQLite can't change a CHECK, so activities is rebuilt: source gains 'receipt', and receipt_key makes one
-- refund claimable once across all students. No table references activities; every row is copied.
CREATE TABLE activities_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  category TEXT NOT NULL CHECK (category IN ('food','mobility','waste')),
  type TEXT NOT NULL CHECK (type IN ('meal','drink','byo','trip','steps','container_return')),
  kg_co2e REAL,
  points INTEGER NOT NULL DEFAULT 0,
  verified INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('qr','nfc','manual','photo','receipt')),
  token_id TEXT REFERENCES tokens(id),
  stall_id TEXT REFERENCES stalls(id),
  item_id TEXT REFERENCES items(id),
  low_carbon INTEGER,
  image_hash TEXT UNIQUE,
  receipt_key TEXT UNIQUE,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
INSERT INTO activities_new (id, user_id, category, type, kg_co2e, points, verified, source, token_id, stall_id, item_id, low_carbon, image_hash, detail_json, created_at)
  SELECT id, user_id, category, type, kg_co2e, points, verified, source, token_id, stall_id, item_id, low_carbon, image_hash, detail_json, created_at FROM activities;
DROP TABLE activities;
ALTER TABLE activities_new RENAME TO activities;
CREATE INDEX idx_activities_user_time ON activities (user_id, created_at);
CREATE INDEX idx_activities_stall_time ON activities (stall_id, created_at);
