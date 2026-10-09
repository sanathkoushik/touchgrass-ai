import { describe, expect, it, vi } from 'vitest'
import type { NearbyResponse, NearbyPlace, PlaceKindId } from '@/shared/places'
import { createApp } from './app'
import type { NearbyProvider } from './context/overpass'
import { MemoryRepository } from './repository'

const SESSION = '5a3b8c1e-5d4a-4b7e-9c6d-1a2b3c4d5e6f'
const HERE = { lat: 12.971234, lon: 77.594567 }
const SAMPLE: NearbyPlace[] = [{ name: 'Cubbon Park', distance_m: 600, osm: 'way/1' }]

function setup(script: NearbyPlace[] | null | 'throw' | 'none') {
  const calls: [PlaceKindId, number, number][] = []
  const places: NearbyProvider = {
    async nearby(kind, lat, lon) {
      calls.push([kind, lat, lon])
      if (script === 'throw') throw new Error('overpass exploded at https://secret.example')
      return script === 'none' ? null : script
    },
  }
  const app = createApp({ repo: new MemoryRepository(), ...(script === 'none' ? {} : { places }) })
  const post = async (body: unknown, session: string | null = SESSION) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (session) headers['x-session-id'] = session
    const res = await app.request('/api/nearby', { method: 'POST', headers, body: JSON.stringify(body) })
    return { status: res.status, json: (await res.json()) as NearbyResponse & { error?: unknown } }
  }
  return { post, calls }
}

describe('POST /api/nearby', () => {
  it('returns real places for an activity that happens at a kind of place, using a ROUNDED location', async () => {
    const s = setup(SAMPLE)
    const r = await s.post({ location: HERE, activity_id: 'park_sit_and_watch' })
    expect(r.status).toBe(200)
    expect(r.json).toEqual({ available: true, kind: { id: 'park', label: 'Parks and gardens' }, places: SAMPLE })
    expect(s.calls).toEqual([['park', 12.97, 77.59]])
  })

  it('does not call anyone for an activity with no place (home, any street)', async () => {
    const s = setup(SAMPLE)
    const r = await s.post({ location: HERE, activity_id: 'doorstep_reset' })
    expect(r.json).toEqual({ available: true, places: [] })
    expect(s.calls).toHaveLength(0)
  })

  it('treats an unknown activity like one with no place, without leaking anything', async () => {
    const r = await setup(SAMPLE).post({ location: HERE, activity_id: 'made_up_thing' })
    expect(r.status).toBe(200)
    expect(r.json.places).toEqual([])
  })

  it('says "not available" instead of failing when the places service cannot help', async () => {
    for (const script of [null, 'throw', 'none'] as const) {
      const r = await setup(script).post({ location: HERE, activity_id: 'new_cafe_walk' })
      expect(r.status, String(script)).toBe(200)
      expect(r.json, String(script)).toEqual({ available: false, places: [] })
      expect(JSON.stringify(r.json)).not.toContain('secret.example')
    }
  })

  it('distinguishes "service down" from "nothing nearby"', async () => {
    const r = await setup([]).post({ location: HERE, activity_id: 'new_cafe_walk' })
    expect(r.json).toMatchObject({ available: true, places: [] })
  })

  it('validates its input and needs a session', async () => {
    const s = setup(SAMPLE)
    for (const body of [{}, { activity_id: 'x' }, { location: HERE }, { location: { lat: 99, lon: 0 }, activity_id: 'x' }, { location: HERE, activity_id: '' }, { location: HERE, activity_id: 'x', extra: 1 }]) {
      expect((await s.post(body)).status, JSON.stringify(body)).toBe(400)
    }
    expect((await s.post({ location: HERE, activity_id: 'new_cafe_walk' }, null)).status).toBe(401)
  })

  it('never logs the location', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await setup(SAMPLE).post({ location: HERE, activity_id: 'new_cafe_walk' })
    expect(log.mock.calls.map((c) => c.join(' ')).join('\n')).not.toMatch(/12\.97|77\.59/)
    log.mockRestore()
  })
})
