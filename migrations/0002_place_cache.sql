-- TouchGrass AI: shared cache of nearby places (Stage 10).
-- Holds ONLY public OpenStreetMap results for a kind of place in a ~1 km cell. There is no user key and no session:
-- nothing in this table says who asked.

CREATE TABLE place_cache (
  -- "<kind>|<lat>,<lon>" with coordinates rounded to 2 decimals, e.g. "park|12.97,77.59"
  cache_key  TEXT    PRIMARY KEY,
  -- JSON array of {name, distance_m, osm}
  data       TEXT    NOT NULL,
  -- when it was fetched from OpenStreetMap, epoch milliseconds
  fetched_at INTEGER NOT NULL
);

-- Cheap "older than X" pruning.
CREATE INDEX idx_place_cache_fetched ON place_cache (fetched_at);
