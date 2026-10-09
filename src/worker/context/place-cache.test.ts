import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import placeCacheSql from '../../../migrations/0002_place_cache.sql?raw'
import type { NearbyPlace } from '@/shared/places'
import { OverpassProvider } from './overpass'
import { D1PlaceCache, MemoryPlaceCache, PLACE_CACHE_RETENTION_MS, type PlaceCache } from './place-cache'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const SAMPLE: NearbyPlace[] = [{ name: 'Sampangi Tank Park', distance_m: 200, osm: 'way/1' }]
const KEY = 'park|12.97,77.59'

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
const live = { elements: [{ type: 'way', id: 9, center: { lat: 12.972, lon: 77.59 }, tags: { name: 'Fresh Park' } }] }

function fake(handler: () => Response) {
  let calls = 0
  const fn = (async () => {
    calls++
    return handler()
  }) as unknown as typeof fetch
  return { fn, count: () => calls }
}

describe('shared cache with the provider', () => {
  it('serves a fresh shared answer without calling OpenStreetMap, and fills the in-memory cache', async () => {
    const shared = new MemoryPlaceCache()
    await shared.put(KEY, { at: 1_000_000, places: SAMPLE })
    const f = fake(() => ok(live))
    const p = new OverpassProvider({ fetchFn: f.fn, now: () => 1_000_000 + 2 * HOUR })
    expect(await p.nearby('park', 12.97, 77.59, shared)).toEqual(SAMPLE)
    expect(await p.nearby('park', 12.97, 77.59)).toEqual(SAMPLE) // now in memory, no shared cache needed
    expect(f.count()).toBe(0)
  })

  it('asks OpenStreetMap when the shared answer is a day old, and saves the new one for everyone', async () => {
    const shared = new MemoryPlaceCache()
    await shared.put(KEY, { at: 0, places: SAMPLE })
    const f = fake(() => ok(live))
    const p = new OverpassProvider({ fetchFn: f.fn, now: () => DAY + 1 })
    const out = await p.nearby('park', 12.97, 77.59, shared)
    expect(out![0]!.name).toBe('Fresh Park')
    expect(f.count()).toBe(1)
    expect(shared.entries.get(KEY)!.places[0]!.name).toBe('Fresh Park')
    expect(shared.entries.get(KEY)!.at).toBe(DAY + 1)
  })

  it('falls back to an older shared answer when OpenStreetMap fails, instead of showing nothing', async () => {
    const shared = new MemoryPlaceCache()
    await shared.put(KEY, { at: 0, places: SAMPLE })
    for (const handler of [() => new Response('busy', { status: 429 }), () => new Response('heavy', { status: 504 }), () => ok({ nope: 1 })]) {
      const p = new OverpassProvider({ fetchFn: fake(handler).fn, now: () => 5 * DAY })
      expect(await p.nearby('park', 12.97, 77.59, shared)).toEqual(SAMPLE)
    }
  })

  it('also serves the older answer while the service is cooling down (no new request at all)', async () => {
    const shared = new MemoryPlaceCache()
    await shared.put('cafe|1,1', { at: 0, places: SAMPLE })
    let t = 5 * DAY
    const f = fake(() => new Response('busy', { status: 429 }))
    const p = new OverpassProvider({ fetchFn: f.fn, now: () => t })
    await p.nearby('park', 5, 5, shared) // fails, starts the cool-down
    expect(await p.nearby('cafe', 1, 1, shared)).toEqual(SAMPLE)
    expect(f.count()).toBe(1)
  })

  it('does not show an answer older than 14 days', async () => {
    const shared = new MemoryPlaceCache()
    await shared.put(KEY, { at: 0, places: SAMPLE })
    const p = new OverpassProvider({ fetchFn: fake(() => new Response('x', { status: 500 })).fn, now: () => PLACE_CACHE_RETENTION_MS + 1 })
    expect(await p.nearby('park', 12.97, 77.59, shared)).toBeNull()
  })

  it('a broken shared cache never breaks the feature', async () => {
    const broken: PlaceCache = {
      get: async () => {
        throw new Error('db down')
      },
      put: async () => {
        throw new Error('db down')
      },
    }
    const p = new OverpassProvider({ fetchFn: fake(() => ok(live)).fn })
    expect((await p.nearby('park', 12.97, 77.59, broken))![0]!.name).toBe('Fresh Park')
  })

  it('works with no shared cache at all', async () => {
    expect((await new OverpassProvider({ fetchFn: fake(() => ok(live)).fn }).nearby('park', 12.97, 77.59))![0]!.name).toBe('Fresh Park')
  })
})

describe('D1PlaceCache (real local D1 engine)', () => {
  let db: D1Database
  let dispose: () => Promise<void>
  let now = 10 * DAY

  beforeAll(async () => {
    const proxy = await getPlatformProxy<Env>({ persist: false })
    db = proxy.env.DB
    dispose = proxy.dispose
    const statements = placeCacheSql
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
    for (const s of statements) await db.prepare(s).run()
  }, 60_000)
  afterAll(async () => dispose())
  beforeEach(async () => {
    await db.prepare('DELETE FROM place_cache').run()
  })

  const cache = () => new D1PlaceCache(db, () => now)

  it('round-trips and misses on unknown keys', async () => {
    await cache().put(KEY, { at: 123, places: SAMPLE })
    expect(await cache().get(KEY)).toEqual({ at: 123, places: SAMPLE })
    expect(await cache().get('park|0,0')).toBeNull()
  })

  it('updates in place rather than adding rows', async () => {
    await cache().put(KEY, { at: 1, places: SAMPLE })
    await cache().put(KEY, { at: 2, places: [] })
    expect(await cache().get(KEY)).toEqual({ at: 2, places: [] })
    expect((await db.prepare('SELECT COUNT(*) AS n FROM place_cache').first<{ n: number }>())!.n).toBe(1)
  })

  it('deletes entries past the retention window when anything is written', async () => {
    await db.prepare('INSERT INTO place_cache VALUES (?, ?, ?)').bind('old|1,1', '[]', now - PLACE_CACHE_RETENTION_MS - 1).run()
    await db.prepare('INSERT INTO place_cache VALUES (?, ?, ?)').bind('recent|1,1', '[]', now - 1000).run()
    await cache().put(KEY, { at: now, places: SAMPLE })
    const keys = (await db.prepare('SELECT cache_key FROM place_cache ORDER BY cache_key').all<{ cache_key: string }>()).results.map((r) => r.cache_key)
    expect(keys).toEqual([KEY, 'recent|1,1'])
  })

  it('treats a corrupt or tampered row as a miss, never a crash', async () => {
    for (const data of ['not json', '{"a":1}', '[{"name":1}]', '[{"name":"x","distance_m":5,"osm":"javascript:alert(1)"}]']) {
      await db.prepare('INSERT OR REPLACE INTO place_cache VALUES (?, ?, ?)').bind('bad|1,1', data, now).run()
      expect(await cache().get('bad|1,1'), data).toBeNull()
    }
  })

  it('is safe against hostile keys (parameterised SQL)', async () => {
    const evil = "park|1,1'; DROP TABLE place_cache; --"
    await cache().put(evil, { at: now, places: SAMPLE })
    expect(await cache().get(evil)).toEqual({ at: now, places: SAMPLE })
    expect((await db.prepare('SELECT COUNT(*) AS n FROM place_cache').first<{ n: number }>())!.n).toBe(1)
  })

  it('stores no user identifiers: the table has no user column', async () => {
    const cols = (await db.prepare("SELECT name FROM pragma_table_info('place_cache')").all<{ name: string }>()).results.map((r) => r.name)
    expect(cols.sort()).toEqual(['cache_key', 'data', 'fetched_at'])
  })
})
