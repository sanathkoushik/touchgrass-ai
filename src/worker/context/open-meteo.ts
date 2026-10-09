import { z } from 'zod'
import { roundCoord } from '@/shared/context'
import type { WeatherCategory } from '@/shared/engine/types'
import type { Conditions, ContextProvider, Place } from './provider'

/**
 * Free weather and geocoding from Open-Meteo (https://open-meteo.com). No account or key.
 * Terms (checked 2026-10-09): free for NON-COMMERCIAL use, under 10,000 calls/day, attribution required (CC-BY 4.0).
 * Their server logs may keep request coordinates for 90 days, which the consent text in the app says plainly.
 */
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search'

const CACHE_TTL_MS = 10 * 60_000
const CACHE_MAX_ENTRIES = 200
const COOLDOWN_MS = 30_000

/**
 * WMO weather interpretation codes (from Open-Meteo's docs) mapped onto the engine's six categories.
 * Unknown codes return null so we plan without weather rather than guess.
 */
export function wmoToCategory(code: number): WeatherCategory | null {
  if (code === 0 || code === 1) return 'clear' // clear sky, mainly clear
  if (code === 2 || code === 3) return 'cloudy' // partly cloudy, overcast
  if (code === 45 || code === 48) return 'fog'
  if ((code >= 51 && code <= 57) || (code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain' // drizzle, rain, showers
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow'
  if (code === 95 || code === 96 || code === 97 || code === 99) return 'storm'
  return null
}

const forecastSchema = z.object({
  utc_offset_seconds: z.number().int(),
  current: z.object({
    temperature_2m: z.number(),
    weather_code: z.number().int(),
    is_day: z.union([z.literal(0), z.literal(1)]),
  }),
  daily: z
    .object({ sunrise: z.array(z.string()).optional(), sunset: z.array(z.string()).optional() })
    .optional(),
})

const placesSchema = z.object({
  results: z
    .array(
      z.object({
        name: z.string(),
        latitude: z.number(),
        longitude: z.number(),
        admin1: z.string().optional(),
        country: z.string().optional(),
      }),
    )
    .optional(),
})

/** "2026-10-09T18:04" -> "18:04" */
const clock = (iso: string | undefined): string | undefined => {
  const m = iso ? /T(\d{2}:\d{2})/.exec(iso) : null
  return m ? m[1] : undefined
}

export interface OpenMeteoOptions {
  /** Injectable for tests. */
  fetchFn?: typeof fetch
  now?: () => number
  /** Hard limit per call: the weather must never be able to slow a recommendation noticeably. */
  timeoutMs?: number
}

export class OpenMeteoProvider implements ContextProvider {
  private readonly fetchFn: typeof fetch
  private readonly now: () => number
  private readonly timeoutMs: number
  private blockedUntil = 0
  private readonly cache = new Map<string, { at: number; value: Conditions }>()

  constructor(opts: OpenMeteoOptions = {}) {
    this.fetchFn = opts.fetchFn ?? ((input, init) => fetch(input, init))
    this.now = opts.now ?? Date.now
    this.timeoutMs = opts.timeoutMs ?? 2000
  }

  /** Stops hammering a service that just failed; the app plans without that context meanwhile. */
  private fail(kind: string, cooldown = true): null {
    if (cooldown) this.blockedUntil = this.now() + COOLDOWN_MS
    // Operational log only: never the coordinates or the query.
    console.log(JSON.stringify({ t: 'context', status: 'failed', kind }))
    return null
  }

  private async getJson(url: string, ttlSeconds: number): Promise<unknown | null> {
    if (this.now() < this.blockedUntil) return null
    let res: Response
    try {
      res = await this.fetchFn(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
        // Lets Cloudflare's edge cache share answers between nearby users. Ignored outside Workers.
        cf: { cacheTtl: ttlSeconds, cacheEverything: true },
      } as RequestInit)
    } catch (err) {
      return this.fail((err as { name?: string })?.name === 'TimeoutError' ? 'timeout' : 'network')
    }
    // A 4xx that is not 429 means THIS request was bad, not that the service is down: no cool-down.
    if (!res.ok) return this.fail(`http_${res.status}`, res.status === 429 || res.status >= 500)
    try {
      return await res.json()
    } catch {
      return this.fail('bad_json')
    }
  }

  async conditions(lat: number, lon: number): Promise<Conditions | null> {
    const la = roundCoord(lat)
    const lo = roundCoord(lon)
    const key = `${la},${lo}`
    const hit = this.cache.get(key)
    if (hit && this.now() - hit.at < CACHE_TTL_MS) return hit.value

    const url = `${FORECAST_URL}?latitude=${la}&longitude=${lo}&current=temperature_2m,weather_code,is_day&daily=sunrise,sunset&forecast_days=1&timezone=auto`
    const json = await this.getJson(url, 600)
    if (json === null) return null

    const parsed = forecastSchema.safeParse(json)
    if (!parsed.success) return this.fail('unexpected_shape')
    const category = wmoToCategory(parsed.data.current.weather_code)
    if (category === null) return this.fail('unknown_weather_code')

    const value: Conditions = {
      category,
      temp_c: Math.round(parsed.data.current.temperature_2m),
      is_day: parsed.data.current.is_day === 1,
      utc_offset_seconds: parsed.data.utc_offset_seconds,
      ...(clock(parsed.data.daily?.sunrise?.[0]) ? { sunrise: clock(parsed.data.daily?.sunrise?.[0]) } : {}),
      ...(clock(parsed.data.daily?.sunset?.[0]) ? { sunset: clock(parsed.data.daily?.sunset?.[0]) } : {}),
    }

    if (this.cache.size >= CACHE_MAX_ENTRIES) this.cache.delete(this.cache.keys().next().value as string)
    this.cache.set(key, { at: this.now(), value })
    return value
  }

  async places(query: string): Promise<Place[] | null> {
    const q = query.trim()
    if (q.length < 2) return []
    const url = `${GEOCODING_URL}?name=${encodeURIComponent(q)}&count=5&language=en&format=json`
    const json = await this.getJson(url, 3600)
    if (json === null) return null
    const parsed = placesSchema.safeParse(json)
    if (!parsed.success) return this.fail('unexpected_shape')
    return (parsed.data.results ?? [])
      .filter((r) => Math.abs(r.latitude) <= 90 && Math.abs(r.longitude) <= 180)
      .map((r) => ({
        name: r.name,
        ...(r.admin1 ? { region: r.admin1 } : {}),
        ...(r.country ? { country: r.country } : {}),
        // Rounded here too: the app never needs more precision than weather does.
        lat: roundCoord(r.latitude),
        lon: roundCoord(r.longitude),
      }))
  }
}
