-- Rewards (spec 2026-10-07-rewards-design.md §4). Spending lowers a separate balance; ranks never read these tables.
CREATE TABLE rewards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cost INTEGER NOT NULL CHECK (cost > 0),
  stall_id TEXT REFERENCES stalls(id),
  weekly_stock INTEGER CHECK (weekly_stock IS NULL OR weekly_stock >= 0),
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE redemptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  reward_id TEXT NOT NULL REFERENCES rewards(id),
  code TEXT NOT NULL,
  cost INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','redeemed','expired')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  redeemed_at INTEGER,
  stall_id TEXT REFERENCES stalls(id)
);
CREATE UNIQUE INDEX redemptions_one_pending ON redemptions (user_id) WHERE status = 'pending';
CREATE UNIQUE INDEX redemptions_pending_code ON redemptions (code) WHERE status = 'pending';
CREATE INDEX redemptions_user ON redemptions (user_id, created_at);
CREATE INDEX redemptions_reward ON redemptions (reward_id, created_at);
