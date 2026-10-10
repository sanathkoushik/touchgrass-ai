-- TouchGrass AI: the Mission Companion (Stage 13).
--   started_at: when the person set off (ISO, from their own device), the "mission_started_at" of the mission record
--   reflection: what they told us afterwards, as JSON (feeling, what helped, what was hard, would repeat, a note, whether
--               a photo was kept ON THEIR DEVICE; photos themselves are never uploaded)
-- Both are optional: older events simply have neither.

ALTER TABLE events ADD COLUMN started_at TEXT;
ALTER TABLE events ADD COLUMN reflection TEXT;
