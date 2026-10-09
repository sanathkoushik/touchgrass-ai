import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenMeteoProvider, wmoToCategory } from './open-meteo'

// A scripted stand-in for Open-Meteo. Nothing here touches the network.

const forecast = (over: { code?: number; temp?: number; is_day?: 0 | 1; offset?: number } = {}) => ({
  latitude: 12.97,
  longitude: 77.56,
  utc_offset_seconds: over.offset ?? 19800,
  timezone: 'Asia/Kolkata',
  current: { time: '2026-10-09T17:45', interval: 900, temperature_2m: over.temp ?? 26.4, weather_code: over.code ?? 0, is_day: over.is_day ?? 1 },
  daily: { time: ['2026-10-09'], sunrise: ['2026-10-09T06:09'], sunset: ['2026-10-09T18:04'] },
})

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

function fakeFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: string[] = []
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push(url)
    return handler(url, init)
  })
  return { fn: fn as unknown as typeof fetch, calls }
}

afterEach(() => vi.restoreAllMocks())

describe('wmoToCategory', () => {
  // Every code in Open-Meteo's documented WMO table.
  const table: [number[], string][] = [
    [[0, 1], 'clear'],
    [[2, 3], 'cloudy'],
    [[45, 48], 'fog'],
    [[51, 53, 55, 56, 57], 'rain'], // drizzle, freezing drizzle
    [[61, 63, 65, 66, 67], 'rain'], // rain, freezing rain
    [[80, 81, 82], 'rain'], // rain showers
    [[71, 73, 75, 77, 85, 86], 'snow'],
    [[95, 96, 97, 99], 'storm'],
  ]
  it.each(table)('maps %j to %s', (codes, category) => {
    for (const code of codes) expect(wmoToCategory(code), `code ${code}`).toBe(category)
  })

  it('refuses to guess for codes it does not know', () => {
    for (const code of [-1, 4, 10, 44, 50, 60, 70, 79, 90, 94, 98, 100, 1000]) expect(wmoToCategory(code), `code ${code}`).toBeNull()
  })
})

describe('OpenMeteoProvider.conditions', () => {
  it('asks for exactly what it needs, with coordinates rounded to ~1 km', async () => {
    const { fn, calls } = fakeFetch(() => ok(forecast()))
    await new OpenMeteoProvider({ fetchFn: fn }).conditions(12.971234, 77.594567)
    const url = new URL(calls[0]!)
    expect(url.origin + url.pathname).toBe('https://api.open-meteo.com/v1/forecast')
    expect(url.searchParams.get('latitude')).toBe('12.97')
    expect(url.searchParams.get('longitude')).toBe('77.59')
    expect(url.searchParams.get('current')).toBe('temperature_2m,weather_code,is_day')
    expect(url.searchParams.get('timezone')).toBe('auto')
    expect(calls[0]).not.toContain('12.971234')
  })

  it('returns real values from the response', async () => {
    const { fn } = fakeFetch(() => ok(forecast({ code: 61, temp: 22.6, is_day: 0 })))
    const c = await new OpenMeteoProvider({ fetchFn: fn }).conditions(12.97, 77.59)
    expect(c).toEqual({ category: 'rain', temp_c: 23, is_day: false, sunrise: '06:09', sunset: '18:04', utc_offset_seconds: 19800 })
  })

  it('works without sunrise/sunset in the response', async () => {
    const body = forecast()
    delete (body as { daily?: unknown }).daily
    const c = await new OpenMeteoProvider({ fetchFn: fakeFetch(() => ok(body)).fn }).conditions(1, 1)
    expect(c).toMatchObject({ category: 'clear' })
    expect(c).not.toHaveProperty('sunrise')
  })

  it('shares one answer between people in the same ~1 km cell for 10 minutes, then asks again', async () => {
    let t = 1_000_000
    const { fn, calls } = fakeFetch(() => ok(forecast()))
    const p = new OpenMeteoProvider({ fetchFn: fn, now: () => t })
    await p.conditions(12.971, 77.591)
    await p.conditions(12.9651, 77.5949) // also rounds to 12.97, 77.59: the same cell
    expect(calls).toHaveLength(1)
    await p.conditions(12.98, 77.59) // a different cell
    expect(calls).toHaveLength(2)
    t += 10 * 60_000 + 1
    await p.conditions(12.971, 77.591)
    expect(calls).toHaveLength(3)
  })

  it('stops calling a service that just failed, and recovers after 30 s', async () => {
    let t = 5_000_000
    let healthy = false
    const { fn, calls } = fakeFetch(() => (healthy ? ok(forecast()) : new Response('down', { status: 503 })))
    const p = new OpenMeteoProvider({ fetchFn: fn, now: () => t })
    expect(await p.conditions(1, 1)).toBeNull()
    expect(await p.conditions(2, 2)).toBeNull() // skipped, not even attempted
    expect(calls).toHaveLength(1)
    healthy = true
    t += 30_001
    expect(await p.conditions(2, 2)).not.toBeNull()
    expect(calls).toHaveLength(2)
  })

  it.each([
    ['a network error', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['a 429 rate limit', () => new Response('slow down', { status: 429 })],
    ['a 500', () => new Response('oops', { status: 500 })],
    ['invalid JSON', () => new Response('<html>', { status: 200 })],
    ['an unexpected shape', () => ok({ hello: 'world' })],
    ['an unknown weather code', () => ok(forecast({ code: 4 }))],
    ['a missing temperature', () => ok({ utc_offset_seconds: 0, current: { weather_code: 0, is_day: 1 } })],
  ])('returns null (never throws) on %s', async (_name, handler) => {
    const p = new OpenMeteoProvider({ fetchFn: fakeFetch(handler as never).fn })
    await expect(p.conditions(12.97, 77.59)).resolves.toBeNull()
  })

  it('does not put the whole feature on cool-down for one bad request (4xx)', async () => {
    const { fn, calls } = fakeFetch(() => new Response('bad', { status: 400 }))
    const p = new OpenMeteoProvider({ fetchFn: fn })
    await p.conditions(1, 1)
    await p.conditions(2, 2)
    expect(calls).toHaveLength(2)
  })

  it('gives up at its time limit even if the service never answers', async () => {
    const hang = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)))
    const p = new OpenMeteoProvider({ fetchFn: fakeFetch(hang).fn, timeoutMs: 60 })
    const t0 = Date.now()
    await expect(p.conditions(12.97, 77.59)).resolves.toBeNull()
    expect(Date.now() - t0).toBeLessThan(1500)
  })

  it('never writes coordinates to the logs', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const p = new OpenMeteoProvider({ fetchFn: fakeFetch(() => new Response('x', { status: 500 })).fn })
    await p.conditions(12.97, 77.59)
    const logged = log.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(logged).toContain('failed')
    expect(logged).not.toMatch(/12\.97|77\.59/)
  })
})

describe('OpenMeteoProvider.places', () => {
  const geo = (results?: unknown[]) => ok(results === undefined ? { generationtime_ms: 0.3 } : { results })

  it('searches by name and returns tidy, rounded results', async () => {
    const { fn, calls } = fakeFetch(() =>
      geo([{ name: 'Bengaluru', latitude: 12.97194, longitude: 77.59369, admin1: 'Karnataka', country: 'India', population: 8_495_492 }]),
    )
    const out = await new OpenMeteoProvider({ fetchFn: fn }).places('Bengal uru')
    expect(out).toEqual([{ name: 'Bengaluru', region: 'Karnataka', country: 'India', lat: 12.97, lon: 77.59 }])
    const url = new URL(calls[0]!)
    expect(url.origin + url.pathname).toBe('https://geocoding-api.open-meteo.com/v1/search')
    expect(url.searchParams.get('name')).toBe('Bengal uru')
    expect(url.searchParams.get('count')).toBe('5')
  })

  it('returns an empty list when nothing matches (Open-Meteo omits "results")', async () => {
    expect(await new OpenMeteoProvider({ fetchFn: fakeFetch(() => geo()).fn }).places('zzzzzz')).toEqual([])
  })

  it('does not even call the service for a query that is too short', async () => {
    const { fn, calls } = fakeFetch(() => geo([]))
    expect(await new OpenMeteoProvider({ fetchFn: fn }).places(' a ')).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it('drops results with impossible coordinates and keeps optional fields optional', async () => {
    const { fn } = fakeFetch(() =>
      geo([
        { name: 'Nowhere', latitude: 123, longitude: 5 },
        { name: 'Hamlet', latitude: 10.123, longitude: 20.456 },
      ]),
    )
    expect(await new OpenMeteoProvider({ fetchFn: fn }).places('place')).toEqual([{ name: 'Hamlet', lat: 10.12, lon: 20.46 }])
  })

  it('encodes hostile queries safely', async () => {
    const { fn, calls } = fakeFetch(() => geo([]))
    await new OpenMeteoProvider({ fetchFn: fn }).places('a&count=999#x?y=z')
    const url = new URL(calls[0]!)
    expect(url.searchParams.get('name')).toBe('a&count=999#x?y=z')
    expect(url.searchParams.get('count')).toBe('5')
  })

  it('returns null (not an error) when the service fails', async () => {
    const p = new OpenMeteoProvider({ fetchFn: fakeFetch(() => new Response('x', { status: 502 })).fn })
    await expect(p.places('Mumbai')).resolves.toBeNull()
  })
})
