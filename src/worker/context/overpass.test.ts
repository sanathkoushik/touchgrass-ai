import { afterEach, describe, expect, it, vi } from 'vitest'
import { ACTIVITIES } from '@/shared/engine'
import { PLACE_KINDS, placeKindFor } from '@/shared/places'
import { OverpassProvider, buildQuery, haversineM } from './overpass'

// A scripted stand-in for Overpass. Nothing here touches the network.

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
function fake(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; body: string }[] = []
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: String(init?.body ?? '') })
    return handler(String(input), init)
  })
  return { fn: fn as unknown as typeof fetch, calls }
}
const el = (id: number, name: string | undefined, lat: number, lon: number, type: 'node' | 'way' = 'way') =>
  type === 'node' ? { type, id, lat, lon, tags: name ? { name } : {} } : { type, id, center: { lat, lon }, tags: name ? { name } : {} }

afterEach(() => vi.restoreAllMocks())

describe('place kinds', () => {
  it('only reference real activities, and every kind is used', () => {
    const used = new Set<string>()
    for (const a of ACTIVITIES) {
      const k = placeKindFor(a.id)
      if (k) {
        expect(PLACE_KINDS[k], a.id).toBeTruthy()
        used.add(k)
      }
    }
    expect([...used].sort()).toEqual(Object.keys(PLACE_KINDS).sort())
    expect(placeKindFor('not_an_activity')).toBeNull()
    expect(placeKindFor('badminton_game')).toBe('badminton')
  })

  it('home and anywhere-activities have no place lookup', () => {
    for (const id of ['doorstep_reset', 'stretch_flow', 'living_room_dance', 'rooftop_stargazing', 'new_street_walk']) {
      expect(placeKindFor(id), id).toBeNull()
    }
  })
})

describe('buildQuery', () => {
  it('is built from constants and rounded numbers only', () => {
    expect(buildQuery('park', 12.97, 77.59)).toBe(
      '[out:json][timeout:6];(node(around:2500,12.97,77.59)["leisure"~"^(park|garden)$"]["name"];way(around:2500,12.97,77.59)["leisure"~"^(park|garden)$"]["name"];);out center tags 60;',
    )
  })

  it('ANDs several tag filters', () => {
    expect(buildQuery('football', 1, 2)).toContain('["leisure"~"^(pitch)$"]["sport"~"^(soccer|football)$"]["name"]')
    expect(buildQuery('football', 1, 2)).not.toMatch(/\bnwr\b|relation/) // relations make dense-city queries time out
  })

  it('every kind produces a well-formed query', () => {
    for (const k of Object.keys(PLACE_KINDS) as (keyof typeof PLACE_KINDS)[]) {
      expect(buildQuery(k, 10.5, 20.25), k).toMatch(
        /^\[out:json\]\[timeout:6\];\((?:(?:node|way)\(around:\d+,10\.5,20\.25\)(?:\["[a-z_]+"~"\^\([a-z_|]+\)\$"\])+\["name"\];){2}\);out center tags 60;$/,
      )
    }
  })
})

describe('haversineM', () => {
  it('matches known distances', () => {
    expect(haversineM(0, 0, 0, 0)).toBe(0)
    expect(haversineM(12.97, 77.59, 12.97, 77.6)).toBeGreaterThan(1050)
    expect(haversineM(12.97, 77.59, 12.97, 77.6)).toBeLessThan(1100)
    expect(Math.round(haversineM(51.5074, -0.1278, 48.8566, 2.3522) / 1000)).toBe(344) // London to Paris
  })
})

describe('OverpassProvider', () => {
  it('returns the nearest distinct named places with distances, linking to real OSM objects', async () => {
    const { fn, calls } = fake(() =>
      ok({
        elements: [
          el(1, 'Far Park', 12.99, 77.59),
          el(2, 'Near Park', 12.972, 77.59),
          el(3, 'Near Park', 12.9721, 77.5901), // another part of the same park
          el(4, 'Mid Garden', 12.98, 77.59, 'node'),
          el(5, undefined, 12.9701, 77.59), // no name: dropped
          el(6, 'Fourth', 13.0, 77.6),
        ],
      }),
    )
    const out = await new OverpassProvider({ fetchFn: fn }).nearby('park', 12.971234, 77.594567)
    expect(out!.map((p) => p.name)).toEqual(['Near Park', 'Mid Garden', 'Far Park'])
    expect(out![0]).toEqual({ name: 'Near Park', distance_m: 200, osm: 'way/2' })
    expect(out![1]!.osm).toBe('node/4')
    expect(out!.every((p) => p.distance_m % 50 === 0)).toBe(true)
    // The query used the ROUNDED point, never the exact one.
    expect(decodeURIComponent(calls[0]!.body)).toContain('(around:2500,12.97,77.59)')
    expect(calls[0]!.body).not.toContain('12.971234')
  })

  it('identifies itself politely', async () => {
    let ua = ''
    const { fn } = fake((_u, init) => {
      ua = new Headers(init?.headers).get('user-agent') ?? ''
      return ok({ elements: [] })
    })
    await new OverpassProvider({ fetchFn: fn }).nearby('cafe', 1, 1)
    expect(ua).toMatch(/^TouchGrassAI\//)
  })

  it('returns an empty list (not null) when nothing is nearby', async () => {
    expect(await new OverpassProvider({ fetchFn: fake(() => ok({ elements: [] })).fn }).nearby('market', 1, 1)).toEqual([])
  })

  it('cleans hostile names from volunteers', async () => {
    const nasty = `  <script>alert(1)</script>\u0007  Rose\n\tGarden ${'x'.repeat(200)}`
    const out = await new OverpassProvider({ fetchFn: fake(() => ok({ elements: [el(1, nasty, 1, 1)] })).fn }).nearby('park', 1, 1)
    const name = out![0]!.name
    expect(name).not.toMatch(/[<>\u0000-\u001f]/)
    expect(name.length).toBeLessThanOrEqual(80)
    expect(name).toContain('Rose Garden')
  })

  it('caches for 6 hours per kind and ~1 km cell, then asks again', async () => {
    let t = 1_000_000
    const { fn, calls } = fake(() => ok({ elements: [el(1, 'A', 1, 1)] }))
    const p = new OverpassProvider({ fetchFn: fn, now: () => t })
    await p.nearby('park', 12.971, 77.591)
    await p.nearby('park', 12.9651, 77.5949) // same cell
    expect(calls).toHaveLength(1)
    await p.nearby('cafe', 12.971, 77.591) // different kind
    expect(calls).toHaveLength(2)
    t += 6 * 60 * 60_000 + 1
    await p.nearby('park', 12.971, 77.591)
    expect(calls).toHaveLength(3)
  })

  it('backs off after an outage or rate limit, but still serves what it has cached', async () => {
    let t = 5_000_000
    let healthy = true
    const { fn, calls } = fake(() => (healthy ? ok({ elements: [el(1, 'A', 1, 1)] }) : new Response('busy', { status: 429 })))
    const p = new OverpassProvider({ fetchFn: fn, now: () => t })
    await p.nearby('park', 1, 1)
    healthy = false
    expect(await p.nearby('cafe', 1, 1)).toBeNull()
    expect(await p.nearby('market', 1, 1)).toBeNull() // skipped, not even attempted
    expect(calls).toHaveLength(2)
    expect(await p.nearby('park', 1, 1)).toHaveLength(1) // cached answers survive the outage
    healthy = true
    t += 60_001
    expect(await p.nearby('market', 1, 1)).toHaveLength(1)
  })

  it('a heavy query (504 or timeout) only mutes THAT kind; other kinds keep working', async () => {
    let t = 9_000_000
    const { fn, calls } = fake((_u, init) => (decodeURIComponent(String(init?.body)).includes('amenity') ? ok({ elements: [el(1, 'A', 1, 1)] }) : new Response('too heavy', { status: 504 })))
    const p = new OverpassProvider({ fetchFn: fn, now: () => t })
    expect(await p.nearby('park', 1, 1)).toBeNull()
    expect(await p.nearby('park', 2, 2)).toBeNull() // that kind is muted (not even attempted)
    expect(calls).toHaveLength(1)
    expect(await p.nearby('cafe', 1, 1)).toHaveLength(1) // another kind is fine
    t += 60_001
    expect(await p.nearby('park', 1, 1)).toBeNull() // asked again after the cool-down
    expect(calls).toHaveLength(3)
  })

  it('a client-side timeout also mutes only that kind', async () => {
    const hang = (_u: string, init?: RequestInit) =>
      new Promise<Response>((_, rej) => init?.signal?.addEventListener('abort', () => rej(init.signal?.reason)))
    const p = new OverpassProvider({ fetchFn: fake(hang).fn, timeoutMs: 30 })
    expect(await p.nearby('park', 1, 1)).toBeNull()
    const quick = new OverpassProvider({ fetchFn: fake(() => ok({ elements: [] })).fn })
    expect(await quick.nearby('park', 1, 1)).toEqual([])
  })

  it('a 400 (our query was bad) is not an outage', async () => {
    const { fn, calls } = fake(() => new Response('bad', { status: 400 }))
    const p = new OverpassProvider({ fetchFn: fn })
    await p.nearby('park', 1, 1)
    await p.nearby('cafe', 1, 1)
    expect(calls).toHaveLength(2)
  })

  it.each([
    ['a network error', () => Promise.reject(new TypeError('x'))],
    ['a 500', () => new Response('x', { status: 500 })],
    ['a 504 gateway timeout', () => new Response('x', { status: 504 })],
    ['invalid JSON', () => new Response('<html>', { status: 200 })],
    ['an unexpected shape', () => ok({ elements: 'nope' })],
    ['missing elements', () => ok({ hello: 1 })],
  ])('returns null (never throws) on %s', async (_n, handler) => {
    await expect(new OverpassProvider({ fetchFn: fake(handler as never).fn }).nearby('park', 1, 1)).resolves.toBeNull()
  })

  it('gives up at its time limit', async () => {
    const hang = (_u: string, init?: RequestInit) =>
      new Promise<Response>((_, rej) => init?.signal?.addEventListener('abort', () => rej(init.signal?.reason)))
    const t0 = Date.now()
    await expect(new OverpassProvider({ fetchFn: fake(hang).fn, timeoutMs: 60 }).nearby('park', 1, 1)).resolves.toBeNull()
    expect(Date.now() - t0).toBeLessThan(1500)
  })

  it('never logs coordinates', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await new OverpassProvider({ fetchFn: fake(() => new Response('x', { status: 500 })).fn }).nearby('park', 12.97, 77.59)
    const out = log.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(out).toContain('failed')
    expect(out).not.toMatch(/12\.97|77\.59/)
  })
})
