import { z } from 'zod'
import { roundCoord } from '@/shared/context'
import { PLACE_KINDS, type NearbyPlace, type PlaceKindId } from '@/shared/places'
import { PLACE_CACHE_RETENTION_MS, type PlaceCache, type PlaceCacheEntry } from './place-cache'

/**
 * Nearby places from OpenStreetMap through the public Overpass API (https://overpass-api.de).
 * Policy (checked 2026-10-09): shared public servers; for an app, ALL users' queries count together and regular use
 * should stay small, so every answer is cached for hours, failures cool down, and callers must treat "no answer"
 * as normal. Data is ODbL: the app shows "OpenStreetMap contributors" wherever places appear.
 */
const ENDPOINT = 'https://overpass-api.de/api/interpreter'
const USER_AGENT = 'TouchGrassAI/0.1 (hobby project; https://github.com/sanathkoushik/touchgrass-ai)'
const CACHE_TTL_MS = 6 * 60 * 60_000
/** How long an answer in the shared cache counts as fresh. */
const SHARED_TTL_MS = 24 * 60 * 60_000
const CACHE_MAX_ENTRIES = 300
const COOLDOWN_MS = 60_000
const MAX_RESULTS = 3

export interface NearbyProvider {
  nearby(kind: PlaceKindId, lat: number, lon: number, shared?: PlaceCache): Promise<NearbyPlace[] | null>
}

const responseSchema = z.object({
  elements: z.array(
    z.object({
      type: z.enum(['node', 'way', 'relation']),
      id: z.number().int().positive(),
      lat: z.number().optional(),
      lon: z.number().optional(),
      center: z.object({ lat: z.number(), lon: z.number() }).optional(),
      tags: z.record(z.string(), z.string()).optional(),
    }),
  ),
})

/** Builds the query from constants only: no user text ever reaches it, just rounded numbers and a kind id. */
export function buildQuery(kind: PlaceKindId, lat: number, lon: number): string {
  const def = PLACE_KINDS[kind]
  const filters = def.tags.map(([k, values]) => `["${k}"~"^(${values.join('|')})$"]`).join('')
  // Nodes and ways only, with the area filter first. Measured on the real server (2026-10-09): including relations
  // made dense-city park queries exceed the server's time limit (HTTP 504 after ~9 s); nodes+ways answer in ~2 s.
  // The cost: large places mapped only as relations (some lakes and reserves) are not found.
  const around = `(around:${def.radius_m},${lat},${lon})`
  return `[out:json][timeout:6];(node${around}${filters}["name"];way${around}${filters}["name"];);out center tags 60;`
}

/** Great-circle distance in metres. */
export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(lat2 - lat1)
  const dLon = rad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** Names come from volunteers: strip control characters and cap the length. */
const cleanName = (s: string): string =>
  s
    .replace(/[\u0000-\u001f\u007f]+/g, ' ') // tabs, newlines and other control characters become spaces first
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)

export interface OverpassOptions {
  fetchFn?: typeof fetch
  now?: () => number
  timeoutMs?: number
}

export class OverpassProvider implements NearbyProvider {
  private readonly fetchFn: typeof fetch
  private readonly now: () => number
  private readonly timeoutMs: number
  /** The whole service is struggling (rate limit, unavailable, unreachable): stop asking for anything. */
  private blockedUntil = 0
  /** One kind's query was too heavy (timeout / server time limit): stop asking for THAT kind, others are fine. */
  private readonly kindBlockedUntil = new Map<PlaceKindId, number>()
  private readonly cache = new Map<string, { at: number; value: NearbyPlace[] }>()

  constructor(opts: OverpassOptions = {}) {
    this.fetchFn = opts.fetchFn ?? ((input, init) => fetch(input, init))
    this.now = opts.now ?? Date.now
    this.timeoutMs = opts.timeoutMs ?? 7000
  }

  private fail(reason: string, scope: 'service' | 'kind' | 'none' = 'service', kind?: PlaceKindId): null {
    if (scope === 'service') this.blockedUntil = this.now() + COOLDOWN_MS
    if (scope === 'kind' && kind) this.kindBlockedUntil.set(kind, this.now() + COOLDOWN_MS)
    console.log(JSON.stringify({ t: 'places', status: 'failed', kind: reason })) // never the coordinates
    return null
  }

  /**
   * Order of preference: this instance's memory (6 h) -> the shared cache (24 h) -> OpenStreetMap -> an older shared
   * answer (up to 14 days) if OpenStreetMap cannot help. Null only when there is truly nothing to show.
   */
  async nearby(kind: PlaceKindId, lat: number, lon: number, shared?: PlaceCache): Promise<NearbyPlace[] | null> {
    const la = roundCoord(lat)
    const lo = roundCoord(lon)
    const key = `${kind}|${la},${lo}`
    const hit = this.cache.get(key)
    if (hit && this.now() - hit.at < CACHE_TTL_MS) return hit.value

    let stored: PlaceCacheEntry | null = null
    if (shared) {
      try {
        stored = await shared.get(key)
      } catch {
        stored = null // a broken cache must never break the feature
      }
      if (stored && this.now() - stored.at < SHARED_TTL_MS) return this.remember(key, stored.at, stored.places)
    }
    const stale = stored && this.now() - stored.at < PLACE_CACHE_RETENTION_MS ? stored.places : null

    if (this.now() < this.blockedUntil || this.now() < (this.kindBlockedUntil.get(kind) ?? 0)) return stale
    const fresh = await this.fetchFresh(kind, la, lo)
    if (fresh === null) return stale

    this.remember(key, this.now(), fresh)
    if (shared) {
      try {
        await shared.put(key, { at: this.now(), places: fresh })
      } catch {
        /* the answer is still good; only the sharing failed */
      }
    }
    return fresh
  }

  private remember(key: string, at: number, value: NearbyPlace[]): NearbyPlace[] {
    if (this.cache.size >= CACHE_MAX_ENTRIES) this.cache.delete(this.cache.keys().next().value as string)
    this.cache.set(key, { at, value })
    return value
  }

  private async fetchFresh(kind: PlaceKindId, la: number, lo: number): Promise<NearbyPlace[] | null> {
    let res: Response
    try {
      res = await this.fetchFn(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', 'user-agent': USER_AGENT },
        body: `data=${encodeURIComponent(buildQuery(kind, la, lo))}`,
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (err) {
      // Too slow: more likely this query is heavy than the whole service being down.
      return (err as { name?: string })?.name === 'TimeoutError' ? this.fail('timeout', 'kind', kind) : this.fail('network')
    }
    // 429 / 502 / 503: the service is struggling, back off from everything. 504: the server's own time limit hit THIS
    // query, so back off from this kind only. 400: our query was bad, not an outage.
    if (!res.ok) {
      const service = res.status === 429 || res.status === 502 || res.status === 503 || res.status >= 505
      return this.fail(`http_${res.status}`, service ? 'service' : res.status === 504 ? 'kind' : 'none', kind)
    }

    let json: unknown
    try {
      json = await res.json()
    } catch {
      return this.fail('bad_json', 'service')
    }
    const parsed = responseSchema.safeParse(json)
    if (!parsed.success) return this.fail('unexpected_shape')

    const seen = new Set<string>()
    const places: (NearbyPlace & { exact: number })[] = []
    for (const el of parsed.data.elements) {
      const name = cleanName(el.tags?.name ?? '')
      const plat = el.lat ?? el.center?.lat
      const plon = el.lon ?? el.center?.lon
      if (!name || plat === undefined || plon === undefined) continue
      const exact = haversineM(la, lo, plat, plon)
      places.push({ name, distance_m: Math.round(exact / 50) * 50, osm: `${el.type}/${el.id}`, exact })
    }
    places.sort((a, b) => a.exact - b.exact)
    const value: NearbyPlace[] = []
    for (const p of places) {
      const dedupe = p.name.toLowerCase() // OSM often has several parts of one park
      if (seen.has(dedupe)) continue
      seen.add(dedupe)
      value.push({ name: p.name, distance_m: p.distance_m, osm: p.osm })
      if (value.length === MAX_RESULTS) break
    }

    return value
  }
}
