-- TouchGrass AI: the Meadow (Stage 12).
-- Two measured facts per mission, both optional (older events simply have none).
--   minutes_outside: minutes the person was away from the app (measured from "Let's go" to "I am back", or what they said)
--   quests_done:     how many of the mission's side quests they ticked off

ALTER TABLE events ADD COLUMN minutes_outside INTEGER CHECK (minutes_outside IS NULL OR (minutes_outside BETWEEN 0 AND 480));
ALTER TABLE events ADD COLUMN quests_done INTEGER CHECK (quests_done IS NULL OR (quests_done BETWEEN 0 AND 3));
