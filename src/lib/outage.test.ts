import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, deleteProfile, getProfile, recommend, saveProfile } from './api'
import { loadCachedProfile } from './mission-store'

// Browser-side behaviour when the server's saved data is unreachable. fetch is faked; nothing touches the network.

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const STORAGE_DOWN = () => json(503, { error: { code: 'storage_unavailable', message: 'Your saved data is temporarily out of reach. Please try again in a moment.' } })

const PROFILE_RESPONSE = {
  profile: {
    preferences: { likes: ['walking'], dislikes: [], preferred_duration_min: 45, social_preference: 'any' as const },
    motivators: ['calm' as const],
    avoidances: [],
    equipment: [],
    goals: ['feel_calmer'],
    schedule_signals: { best_windows: ['17:00-19:00'] },
    updated_at: '2026-10-09T00:00:00.000Z',
  },
  stats: { recommendations: 0, responded: 0, completed: 0, completion_rate: null },
}
const REC = {
  recommendation_id: 'r_00000000-0000-4000-8000-000000000001',
  activity_id: 'brisk_walk_loop',
  title: 'Brisk walk',
  duration_min: 30,
  reason: 'x',
  first_step: 'y',
  social_mode: 'solo',
  fallback: null,
  source: 'deterministic',
  mode: 'normal',
  preparation: [],
  persisted: false,
}

function memoryStorage() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }
}

beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()))
afterEach(() => vi.unstubAllGlobals())

describe('profile copy kept in the browser', () => {
  it('is saved whenever the profile is read or saved, in the shape the server accepts back', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(200, PROFILE_RESPONSE)))
    expect(loadCachedProfile()).toBeNull()
    await getProfile()
    expect(loadCachedProfile()).toEqual({
      preferences: PROFILE_RESPONSE.profile.preferences,
      motivators: ['calm'],
      avoidances: [],
      equipment: [],
      goals: ['feel_calmer'],
      best_windows: ['17:00-19:00'],
    })
  })

  it('is refreshed when the person saves changes, and removed by "Delete my data"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(200, PROFILE_RESPONSE)))
    await saveProfile({ ...loadCachedProfile()!, preferences: PROFILE_RESPONSE.profile.preferences, motivators: ['calm'], avoidances: [], equipment: [], goals: [], best_windows: [] })
    expect(loadCachedProfile()).not.toBeNull()
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { deleted: true })))
    await deleteProfile()
    expect(loadCachedProfile()).toBeNull()
  })

  it('is ignored when corrupt or unreadable', () => {
    localStorage.setItem('tg_profile_cache', '{nope')
    expect(loadCachedProfile()).toBeNull()
    localStorage.setItem('tg_profile_cache', JSON.stringify({ preferences: 5 }))
    expect(loadCachedProfile()).toBeNull()
    vi.stubGlobal('localStorage', undefined)
    expect(loadCachedProfile()).toBeNull()
  })
})

describe('recommend during a storage outage', () => {
  async function primed() {
    vi.stubGlobal('fetch', vi.fn(async () => json(200, PROFILE_RESPONSE)))
    await getProfile()
  }

  it('retries ONCE with the browser copy, and returns the real recommendation', async () => {
    await primed()
    const fetchMock = vi.fn()
    fetchMock.mockResolvedValueOnce(STORAGE_DOWN()).mockResolvedValueOnce(json(200, REC))
    vi.stubGlobal('fetch', fetchMock)
    const rec = await recommend({ duration_limit: 45 })
    expect(rec.title).toBe('Brisk walk')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const first = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))
    const second = JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body))
    expect(first.fallback_profile).toBeUndefined() // the copy is NOT sent unless storage is down
    expect(second.fallback_profile.motivators).toEqual(['calm'])
    expect(second.duration_limit).toBe(45)
  })

  it('does not retry forever: after a second 503 it plans on the device', async () => {
    await primed()
    const fetchMock = vi.fn(async () => STORAGE_DOWN())
    vi.stubGlobal('fetch', fetchMock)
    const rec = await recommend({ duration_limit: 45 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(rec.persisted).toBe(false)
    expect(rec.source).toBe('deterministic')
  })

  it('reports the outage plainly when there is no browser copy yet', async () => {
    const fetchMock = vi.fn(async () => STORAGE_DOWN())
    vi.stubGlobal('fetch', fetchMock)
    const err = await recommend({ duration_limit: 45 }).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.code).toBe('storage_unavailable')
    expect(err.message).toMatch(/try again/i)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('respects an answer the server gave on purpose (no profile, bad request): no local plan', async () => {
    await primed()
    for (const [status, code] of [[404, 'profile_not_found'], [400, 'invalid_request']] as const) {
      const fetchMock = vi.fn(async () => json(status, { error: { code, message: 'm' } }))
      vi.stubGlobal('fetch', fetchMock)
      await expect(recommend({ duration_limit: 45 })).rejects.toMatchObject({ code })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  })
})

describe('server completely unreachable: plan on the device', () => {
  const PROFILE = {
    preferences: { likes: ['badminton'], dislikes: ['walking'], preferred_duration_min: 60, social_preference: 'any' as const },
    motivators: [],
    avoidances: [],
    equipment: ['racket' as const, 'ball' as const],
    goals: [],
    best_windows: [],
  }
  const prime = async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { ...PROFILE_RESPONSE, profile: { ...PROFILE_RESPONSE.profile, preferences: PROFILE.preferences, motivators: [], equipment: PROFILE.equipment, goals: [] } })))
    await getProfile()
  }
  const NOON = new Date('2026-10-07T12:00:00')
  // The engine is time-of-day aware (badminton needs daylight), so pin the clock: these tests must not depend on when they run.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOON)
  })
  afterEach(() => vi.useRealTimers())

  it.each([
    ['a network error', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['a 500', () => json(500, { error: { code: 'internal_error', message: 'x' } })],
    ['a 502 from a proxy', () => new Response('Bad gateway', { status: 502 })],
    ['HTML instead of JSON (no backend behind the page)', () => new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } })],
  ])('gives a real recommendation on %s', async (_n, handler) => {
    await prime()
    vi.stubGlobal('fetch', vi.fn(handler as never))
    const rec = await recommend({ duration_limit: 90, social_available: true, mode: 'normal' })
    expect(rec.activity_id).toBe('badminton_game') // from the browser copy: liked, and the racket and ball are owned
    expect(rec.persisted).toBe(false)
    expect(rec.recommendation_id).toMatch(/^r_[0-9a-f-]{36}$/)
    expect(rec.title.length).toBeGreaterThan(3)
    expect(rec.first_step.length).toBeGreaterThan(3)
    expect(rec.preparation).toContain('Your racket')
  })

  it('honours dislikes and equipment from the browser copy', async () => {
    await prime()
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))))
    for (let i = 0; i < 5; i++) {
      const rec = await recommend({ duration_limit: 20, social_available: false, mode: 'normal' })
      expect(rec.activity_id).not.toBe('brisk_walk_loop') // "walking" is disliked
      expect(rec.activity_id).not.toBe('badminton_game') // needs a partner and 30+ minutes
    }
  })

  it('never claims weather or history it cannot know', async () => {
    await prime()
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))))
    const rec = await recommend({ duration_limit: 60, location: { lat: 12.97, lon: 77.59 } })
    expect(rec.context).toBeUndefined()
    expect(rec.reason).not.toMatch(/degrees|sky|outside|finished this|rated this|last one/i)
  })

  it('adapts the size like the server does, using only what it knows (no history)', async () => {
    await prime()
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))))
    const low = await recommend({ duration_limit: 60, mood: 'low' })
    expect(low.mode).toBe('minimum')
    const asked = await recommend({ duration_limit: 60, mode: 'excellent' })
    expect(asked.mode).toBe('excellent')
  })

  it('without a browser copy there is nothing to plan from: the failure is reported', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))))
    await expect(recommend({ duration_limit: 45 })).rejects.toMatchObject({ code: 'network' })
  })

  it('a cancelled request stays cancelled (the person moved on); it is never answered later', async () => {
    await prime()
    const ac = new AbortController()
    vi.stubGlobal('fetch', vi.fn(async () => { ac.abort(); throw new DOMException('aborted', 'AbortError') }))
    await expect(recommend({ duration_limit: 45 }, ac.signal)).rejects.toMatchObject({ code: 'cancelled' })
  })
})
