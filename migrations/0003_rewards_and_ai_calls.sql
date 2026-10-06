-- Mission rewards take effect from the SGT week they are set, so a change doesn't rewrite past weeks.
CREATE TABLE mission_points (
  mission_id TEXT NOT NULL,
  effective_from INTEGER NOT NULL,
  points INTEGER NOT NULL,
  PRIMARY KEY (mission_id, effective_from)
);
-- Rewards already edited in admin keep applying to all history, as before.
INSERT INTO mission_points (mission_id, effective_from, points)
  SELECT substr(key, 16), 0, CAST(value AS INTEGER) FROM settings WHERE key LIKE 'mission_points_%';
DELETE FROM settings WHERE key LIKE 'mission_points_%';

-- One row per live AI call a student triggers, for the per-student daily limit.
CREATE TABLE ai_calls (
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX ai_calls_user_time ON ai_calls (user_id, created_at);
