CREATE TABLE stalls (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  canteen TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  verify_method TEXT NOT NULL DEFAULT 'qr' CHECK (verify_method IN ('qr','nfc','both'))
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student','seller','admin')),
  stall_id TEXT REFERENCES stalls(id),
  email TEXT,
  email_verified_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE items (
  id TEXT PRIMARY KEY,
  stall_id TEXT NOT NULL REFERENCES stalls(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('meal','drink')),
  parts_json TEXT NOT NULL DEFAULT '{}',
  kg_co2e REAL,
  low_carbon INTEGER NOT NULL DEFAULT 0,
  points INTEGER,               -- NULL = use settings
  status TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('draft','live'))
);

CREATE TABLE tokens (
  id TEXT PRIMARY KEY,
  stall_id TEXT NOT NULL REFERENCES stalls(id),
  item_id TEXT NOT NULL REFERENCES items(id),
  byo INTEGER NOT NULL DEFAULT 0,
  method TEXT NOT NULL DEFAULT 'qr' CHECK (method IN ('qr','nfc')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  pending_user_id TEXT REFERENCES users(id),
  confirmed_at INTEGER,
  used_at INTEGER,
  used_by TEXT REFERENCES users(id)
);

CREATE TABLE activities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  category TEXT NOT NULL CHECK (category IN ('food','mobility','waste')),
  type TEXT NOT NULL CHECK (type IN ('meal','drink','byo','trip','steps','container_return')),
  kg_co2e REAL,
  points INTEGER NOT NULL DEFAULT 0,
  verified INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('qr','nfc','manual','photo')),
  token_id TEXT REFERENCES tokens(id),
  stall_id TEXT REFERENCES stalls(id),
  item_id TEXT REFERENCES items(id),
  low_carbon INTEGER,
  image_hash TEXT UNIQUE,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_activities_user_time ON activities (user_id, created_at);
CREATE INDEX idx_activities_stall_time ON activities (stall_id, created_at);

CREATE TABLE factors (
  key TEXT PRIMARY KEY,
  kg_per_unit REAL,             -- NULL = pending
  unit TEXT NOT NULL CHECK (unit IN ('kg','pkm')),
  source TEXT NOT NULL,
  note TEXT
);

CREATE TABLE locations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE routes (
  from_id TEXT NOT NULL REFERENCES locations(id),
  to_id TEXT NOT NULL REFERENCES locations(id),
  distance_km REAL NOT NULL,
  walk_min REAL NOT NULL,
  shuttle_min REAL,
  placeholder INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (from_id, to_id)
);

CREATE TABLE missions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  metric TEXT NOT NULL,
  target REAL NOT NULL,
  points INTEGER NOT NULL,
  period TEXT NOT NULL CHECK (period IN ('daily','weekly'))
);

CREATE TABLE user_missions (
  user_id TEXT NOT NULL REFERENCES users(id),
  mission_id TEXT NOT NULL REFERENCES missions(id),
  period_start INTEGER NOT NULL,
  progress REAL NOT NULL DEFAULT 0,
  completed_at INTEGER,
  PRIMARY KEY (user_id, mission_id, period_start)
);

CREATE TABLE badges (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  rule TEXT NOT NULL
);

CREATE TABLE user_badges (
  user_id TEXT NOT NULL REFERENCES users(id),
  badge_id TEXT NOT NULL REFERENCES badges(id),
  earned_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, badge_id)
);

CREATE TABLE summaries (
  user_id TEXT NOT NULL REFERENCES users(id),
  week_start INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, week_start)
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
