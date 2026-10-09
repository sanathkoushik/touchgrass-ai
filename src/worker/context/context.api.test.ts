import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiErrorBody, HistoryResponse, RecommendResponse, UpgradeResponse } from '@/shared/api'
import type { ContextResponse, PlacesResponse } from '@/shared/context'
import { getActivity } from '@/shared/engine'
import { AiGate } from '../ai/gate'
import type { AiCompletion, AiProvider, AiRequest } from '../ai/provider'
import { createApp } from '../app'
import { MemoryRepository } from '../repository'
import type { Conditions, ContextProvider, Place } from './provider'

// Synthetic users and a scripted weather service. Nothing here touches the network.

const SESSION = '3f2b8c1e-5d4a-4b7e-9c6d-1a2b3c4d5e6f'
const NOON_UTC = new Date('2026-10-07T12:00:00Z')

const PROFILE = {
  preferences: { likes: ['walking', 'exploring', 'cafe'], dislikes: [], preferred_duration_min: 45, social_preference: 'any' },
  motivators: ['novelty', 'calm'],
  avoidances: [],
  equipment: [],
  best_windows: [],
}

const weather = (over: Partial<Conditions> = {}): Conditions => ({
  category: 'clear',
  temp_c: 26,
  is_day: true,
  sunrise: '06:09',
  sunset: '18:04',
  utc_offset_seconds: 19800,
  ...over,
})

type CtxScript = Conditions | null | 'throw'
function fakeContext(script: CtxScript, places: Place[] | null = []) {
  const conditionCalls: [number, number][] = []
  const placeCalls: string[] = []
  const provider: ContextProvider = {
    async conditions(lat, lon) {
      conditionCalls.push([lat, lon])
      if (script === 'throw') throw new Error('weather service exploded at https://secret.example')
      return script
    },
    async places(q) {
      placeCalls.push(q)
      return places
    },
  }
  return { provider, conditionCalls, placeCalls }
}

function setup(ctx: ReturnType<typeof fakeContext> | undefined, extra: { ai?: AiProvider } = {}) {
  const repo = new MemoryRepository()
  const app = createApp({
    repo,
    now: () => NOON_UTC,
    ...(ctx ? { context: ctx.provider } : {}),
    ...(extra.ai ? { ai: { provider: () => extra.ai ?? null, gate: new AiGate(), timeoutMs: 500 } } : {}),
  })
  const call = async <T>(method: string, path: string, body?: unknown, session: string | null = SESSION) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (session) headers['x-session-id'] = session
    const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: (await res.json()) as T }
  }
  return { app, repo, call }
}

const onboarded = async (s: ReturnType<typeof setup>) => {
  await s.call('POST', '/api/onboarding', PROFILE)
  return s
}
const recommend = (s: ReturnType<typeof setup>, over: Record<string, unknown> = {}) =>
  s.call<RecommendResponse>('POST', '/api/recommend', { duration_limit: 60, use_ai: false, ...over })

const HERE = { lat: 12.971234, lon: 77.594567 }

afterEach(() => vi.restoreAllMocks())

describe('recommend with a shared location', () => {
  it('looks up the weather for a location ROUNDED to ~1 km, never the exact point', async () => {
    const ctx = fakeContext(weather())
    const s = await onboarded(setup(ctx))
    await recommend(s, { location: HERE })
    expect(ctx.conditionCalls).toEqual([[12.97, 77.59]])
  })

  it('shows the live conditions it used', async () => {
    const s = await onboarded(setup(fakeContext(weather({ category: 'cloudy', temp_c: 24 }))))
    const r = await recommend(s, { location: HERE })
    expect(r.json.context).toEqual({ weather: { category: 'cloudy', temp_c: 24 }, daylight: 'day' })
  })

  it('rain changes what is recommended: only weather-proof activities remain', async () => {
    const s = await onboarded(setup(fakeContext(weather({ category: 'rain', temp_c: 21 }))))
    for (let i = 0; i < 3; i++) {
      const r = await recommend(s, { location: HERE })
      expect(getActivity(r.json.activity_id)!.weather, r.json.title).toBe('any')
    }
  })

  it('night removes daytime-only activities, using the real daylight at the place', async () => {
    const s = await onboarded(setup(fakeContext(weather({ is_day: false }))))
    const r = await recommend(s, { location: HERE, duration_limit: 120 })
    expect(getActivity(r.json.activity_id)!.daylight).not.toBe('day')
    expect(r.json.context?.daylight).toBe('night')
  })

  it('extreme heat removes activities that need a comfortable temperature', async () => {
    const s = await onboarded(setup(fakeContext(weather({ temp_c: 41 }))))
    const r = await recommend(s, { location: HERE, duration_limit: 120 })
    expect(getActivity(r.json.activity_id)!.weather).not.toBe('fair')
  })

  it("uses the place's own clock, not the browser's, so daylight and 'too late' are right THERE", async () => {
    // The browser says UTC-5, but the weather place is UTC+5:30. The recorded local time must be the place's.
    const s = await onboarded(setup(fakeContext(weather({ utc_offset_seconds: 19800 }))))
    await recommend(s, { location: HERE, utc_offset_minutes: -300 })
    const hist = await s.call<HistoryResponse>('GET', '/api/history')
    expect(hist.json.items[0]?.timestamp).toBe('2026-10-07T17:30:00+05:30')
  })

  it('plans without weather when the service has nothing for us, and says so honestly', async () => {
    const s = await onboarded(setup(fakeContext(null)))
    const r = await recommend(s, { location: HERE })
    expect(r.status).toBe(200)
    expect(r.json.title.length).toBeGreaterThan(3)
    expect(r.json.context).toBeUndefined()
  })

  it('survives the weather service crashing, and never leaks its error', async () => {
    const s = await onboarded(setup(fakeContext('throw')))
    const r = await recommend(s, { location: HERE })
    expect(r.status).toBe(200)
    expect(JSON.stringify(r.json)).not.toContain('secret.example')
  })

  it('never calls the weather service when no location was shared', async () => {
    const ctx = fakeContext(weather())
    const s = await onboarded(setup(ctx))
    const r = await recommend(s)
    expect(ctx.conditionCalls).toHaveLength(0)
    expect(r.json.context).toBeUndefined()
  })

  it('works with no weather service configured at all', async () => {
    const s = await onboarded(setup(undefined))
    const r = await recommend(s, { location: HERE })
    expect(r.status).toBe(200)
    expect(r.json.context).toBeUndefined()
  })

  it('rejects impossible or over-detailed locations', async () => {
    const s = await onboarded(setup(fakeContext(weather())))
    for (const location of [{ lat: 91, lon: 0 }, { lat: 0, lon: 181 }, { lat: 'x', lon: 1 }, { lat: 1, lon: 1, accuracy: 5 }, { lat: 1 }]) {
      const r = await recommend(s, { location })
      expect(r.status, JSON.stringify(location)).toBe(400)
    }
  })
})

describe('privacy of the location', () => {
  it('is never stored: only the weather category and temperature are kept with the recommendation', async () => {
    const s = await onboarded(setup(fakeContext(weather({ category: 'cloudy', temp_c: 24 }))))
    const r = await recommend(s, { location: HERE })
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(SESSION))
    const userKey = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
    const stored = await s.repo.getEvent(userKey, r.json.recommendation_id)
    const text = JSON.stringify(stored)
    expect(stored?.context.weather).toEqual({ category: 'cloudy', temp_c: 24 })
    expect(text).not.toMatch(/12\.97|77\.59|"lat"|"lon"|latitude|longitude/i)
  })

  it('never appears in the request logs', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const s = await onboarded(setup(fakeContext(weather())))
    await recommend(s, { location: HERE })
    await s.call('POST', '/api/context', { location: HERE })
    const logged = log.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(logged.length).toBeGreaterThan(0)
    expect(logged).not.toMatch(/12\.97|77\.59/)
  })
})

describe('POST /api/context', () => {
  it('returns what it is like outside, with sunrise and sunset', async () => {
    const ctx = fakeContext(weather({ category: 'rain', temp_c: 22, is_day: false }))
    const s = setup(ctx)
    const r = await s.call<ContextResponse>('POST', '/api/context', { location: HERE })
    expect(r.status).toBe(200)
    expect(r.json).toEqual({
      available: true,
      conditions: { weather: { category: 'rain', temp_c: 22 }, daylight: 'night', sunrise: '06:09', sunset: '18:04' },
    })
    expect(ctx.conditionCalls).toEqual([[12.97, 77.59]])
  })

  it('says "not available" instead of failing when the service cannot help', async () => {
    for (const script of [null, 'throw'] as const) {
      const r = await setup(fakeContext(script)).call<ContextResponse>('POST', '/api/context', { location: HERE })
      expect(r.status).toBe(200)
      expect(r.json).toEqual({ available: false })
    }
  })

  it('validates input and needs a session', async () => {
    const s = setup(fakeContext(weather()))
    expect((await s.call('POST', '/api/context', { location: { lat: 200, lon: 0 } })).status).toBe(400)
    expect((await s.call('POST', '/api/context', {})).status).toBe(400)
    const noSession = await s.call<ApiErrorBody>('POST', '/api/context', { location: HERE }, null)
    expect(noSession.status).toBe(401)
  })
})

describe('POST /api/places', () => {
  const sample: Place[] = [{ name: 'Bengaluru', region: 'Karnataka', country: 'India', lat: 12.97, lon: 77.59 }]

  it('finds places by name', async () => {
    const ctx = fakeContext(weather(), sample)
    const r = await setup(ctx).call<PlacesResponse>('POST', '/api/places', { q: '  Bengaluru ' })
    expect(r.json).toEqual({ available: true, places: sample })
    expect(ctx.placeCalls).toEqual(['Bengaluru']) // trimmed
  })

  it('reports "not available" when the service is down, and returns no places', async () => {
    const r = await setup(fakeContext(weather(), null)).call<PlacesResponse>('POST', '/api/places', { q: 'Mumbai' })
    expect(r.json).toEqual({ available: false, places: [] })
    const none = await setup(undefined).call<PlacesResponse>('POST', '/api/places', { q: 'Mumbai' })
    expect(none.json.available).toBe(false)
  })

  it('rejects empty, tiny, huge or malformed searches', async () => {
    const s = setup(fakeContext(weather(), sample))
    for (const body of [{}, { q: '' }, { q: 'a' }, { q: 'x'.repeat(61) }, { q: 5 }, { q: 'ok', extra: 1 }]) {
      expect((await s.call('POST', '/api/places', body)).status, JSON.stringify(body)).toBe(400)
    }
  })
})

describe('the AI sees the same real conditions', () => {
  function scriptedAi() {
    const calls: AiRequest[] = []
    const provider: AiProvider = {
      name: 'scripted',
      async complete(req): Promise<AiCompletion> {
        calls.push(req)
        const payload = JSON.parse(req.user.split('\n')[0]!) as { candidates: { id: string }[] }
        const id = payload.candidates[0]!.id
        return {
          text: JSON.stringify({
            activity_id: id,
            reason: 'You like exploring, and this is a calm way to use your hour.',
            first_step: `${getActivity(id)!.firstStep} Notice one new thing.`,
          }),
          model: 'scripted',
        }
      },
    }
    return { provider, calls }
  }

  it('rebuilds the stored weather for the upgrade, so the AI is asked about the same situation', async () => {
    const ai = scriptedAi()
    const s = await onboarded(setup(fakeContext(weather({ category: 'rain', temp_c: 21 })), { ai: ai.provider }))
    const first = await recommend(s, { location: HERE })
    const up = await s.call<UpgradeResponse>('POST', `/api/recommend/${first.json.recommendation_id}/upgrade`)
    expect(up.json.upgraded).toBe(true)
    expect(ai.calls[0]!.user).toContain('"weather":{"sky":"rain","temp_c":21}')
    expect(ai.calls[0]!.user).toContain('"daylight":"day"')
    // ...and every candidate it was offered really works in the rain.
    const offered = (JSON.parse(ai.calls[0]!.user.split('\n')[0]!) as { candidates: { id: string }[] }).candidates
    for (const c of offered) expect(getActivity(c.id)!.weather).toBe('any')
    expect(up.json.recommendation?.context?.weather).toEqual({ category: 'rain', temp_c: 21 })
  })

  it('sends no weather at all when none is known, and never a location', async () => {
    const ai = scriptedAi()
    const s = await onboarded(setup(fakeContext(null), { ai: ai.provider }))
    const first = await recommend(s, { location: HERE })
    await s.call('POST', `/api/recommend/${first.json.recommendation_id}/upgrade`)
    const user = ai.calls[0]!.user
    // Unknown weather must not be invented, hinted at, or replaced by a default.
    expect(user).not.toContain('"weather"')
    expect(user).not.toContain('"daylight"')
    // And the location itself is never part of the prompt.
    expect(ai.calls[0]!.system + user).not.toMatch(/12\.97|77\.59|latitude|longitude|"lat"|"lon"/i)
  })
})
