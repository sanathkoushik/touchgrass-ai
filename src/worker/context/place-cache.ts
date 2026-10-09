import { z } from 'zod'
import type { NearbyPlace } from '@/shared/places'

/**
 * A cache of nearby-place results shared by every Worker instance (memory for tests, D1 in production).
 * It exists because the public Overpass server is busy and rate-limited: place data changes slowly, so a day-old
 * answer is fine, and a weeks-old one is far better than nothing when OpenStreetMap is unreachable.
 */
export interface PlaceCacheEntry {
  /** Epoch ms when it was fetched. */
  at: number
  places: NearbyPlace[]
}

export interface PlaceCache {
  get(key: string): Promise<PlaceCacheEntry | null>
  put(key: string, entry: PlaceCacheEntry): Promise<void>
}

/** Entries older than this are deleted on write. */
export const PLACE_CACHE_RETENTION_MS = 14 * 86_400_000

export class MemoryPlaceCache implements PlaceCache {
  readonly entries = new Map<string, PlaceCacheEntry>()
  async get(key: string) {
    return this.entries.get(key) ?? null
  }
  async put(key: string, entry: PlaceCacheEntry) {
    this.entries.set(key, entry)
  }
}

const placesSchema = z.array(z.object({ name: z.string().max(80), distance_m: z.number().int().min(0), osm: z.string().regex(/^(node|way|relation)\/\d+$/) }))

/** Cloudflare D1 cache. Parameterised SQL only. A row that no longer parses is treated as a miss. */
export class D1PlaceCache implements PlaceCache {
  private readonly db: D1Database
  private readonly nowMs: () => number

  constructor(db: D1Database, nowMs: () => number = Date.now) {
    this.db = db
    this.nowMs = nowMs
  }

  async get(key: string): Promise<PlaceCacheEntry | null> {
    const row = await this.db.prepare('SELECT data, fetched_at FROM place_cache WHERE cache_key = ?').bind(key).first<{ data: string; fetched_at: number }>()
    if (!row) return null
    try {
      const parsed = placesSchema.safeParse(JSON.parse(row.data))
      return parsed.success ? { at: row.fetched_at, places: parsed.data } : null
    } catch {
      return null
    }
  }

  async put(key: string, entry: PlaceCacheEntry): Promise<void> {
    await this.db.batch([
      this.db
        .prepare(
          'INSERT INTO place_cache (cache_key, data, fetched_at) VALUES (?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at',
        )
        .bind(key, JSON.stringify(entry.places), entry.at),
      this.db.prepare('DELETE FROM place_cache WHERE fetched_at < ?').bind(this.nowMs() - PLACE_CACHE_RETENTION_MS),
    ])
  }
}
