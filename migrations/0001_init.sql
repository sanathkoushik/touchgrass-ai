-- TouchGrass AI: initial schema (Stage 6).
-- user_key is SHA-256(session id), never the session id itself.

CREATE TABLE profiles (
  user_key   TEXT PRIMARY KEY,
  -- StoredProfile as JSON (preferences, motivators, avoidances, equipment, schedule_signals)
  data       TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE events (
  user_key          TEXT    NOT NULL,
  recommendation_id TEXT    NOT NULL,
  activity_id       TEXT    NOT NULL,
  -- the user's local wall-clock time with offset, e.g. 2026-10-07T17:42:00+05:30
  timestamp         TEXT    NOT NULL,
  -- insertion time in epoch milliseconds: used for ordering and for pruning old events
  created_at        INTEGER NOT NULL,
  outcome           TEXT    NOT NULL CHECK (outcome IN ('pending', 'completed', 'partial', 'skipped', 'changed')),
  enjoyment         INTEGER CHECK (enjoyment IS NULL OR (enjoyment BETWEEN 1 AND 5)),
  skip_reason       TEXT,
  responded_at      TEXT,
  -- recommendation context as JSON (duration_limit, mood, social_available, hour, weather?)
  context           TEXT    NOT NULL,
  PRIMARY KEY (user_key, recommendation_id)
);

-- Newest-first listing per user, and cheap "older than X" pruning.
CREATE INDEX idx_events_user_created ON events (user_key, created_at DESC);
