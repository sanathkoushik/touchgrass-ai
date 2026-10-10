import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { profileInputSchema } from '@/shared/api'
import { ACTIVITIES } from '@/shared/engine'
import { matchingTerm } from '@/shared/engine/filter'
import { AVOIDANCES, EQUIPMENT, MOODS, MOTIVATORS, SKIP_REASONS, SOCIAL_PREFERENCES } from '@/shared/engine/types'
import { ApiError, getHistory, getProfile, recommend, sendFeedback, upgradeRecommendation } from './api'
import { clearMission, hasProfileHint, loadMission, saveMission, setProfileHint } from './mission-store'
import { getSessionId, resetSession } from './session'
import {
  AVOIDANCE_LABELS,
  DURATION_CHOICES,
  EQUIPMENT_LABELS,
  INTERESTS,
  MOOD_LABELS,
  MOTIVATOR_LABELS,
  SKIP_REASON_LABELS,
  SOCIAL_LABELS,
  WINDOW_CHOICES,
} from './vocab'

// ------------------------------------------------------------ test helpers (synthetic data only)

function fakeStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() {
      return m.size
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  }
}

const jsonResponse = (status: number, body: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const REC_ID = 'r_3f2b8c1e-5d4a-4b7e-9c6d-1a2b3c4d5e6f'
const MISSION = {
  recommendation_id: REC_ID,
  activity_id: 'brisk_walk_loop',
  title: 'Brisk walk',
  duration_min: 30,
  reason: 'You said you like walking.',
  first_step: 'Put on your shoes.',
  social_mode: 'solo' as const,
  fallback: null,
  source: 'deterministic' as const,
  persisted: true,
  mode: 'normal' as const,
  preparation: [] as string[],
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ------------------------------------------------------------------------------ vocabulary

describe('vocabulary', () => {
  it('every interest chip matches at least one real activity, so choosing it really changes recommendations', () => {
    for (const { label, term } of INTERESTS) {
      const hits = ACTIVITIES.filter((a) => matchingTerm(a, [term]))
      expect(hits.length, `"${label}" (${term}) matches no activity`).toBeGreaterThan(0)
    }
  })

  it('has unique labels and terms', () => {
    expect(new Set(INTERESTS.map((i) => i.term)).size).toBe(INTERESTS.length)
    expect(new Set(INTERESTS.map((i) => i.label)).size).toBe(INTERESTS.length)
  })

  it('has wording for every value the engine understands (no raw codes can reach the screen)', () => {
    expect(Object.keys(MOTIVATOR_LABELS).sort()).toEqual([...MOTIVATORS].sort())
    expect(Object.keys(EQUIPMENT_LABELS).sort()).toEqual([...EQUIPMENT].sort())
    expect(Object.keys(AVOIDANCE_LABELS).sort()).toEqual([...AVOIDANCES].sort())
    expect(Object.keys(SOCIAL_LABELS).sort()).toEqual([...SOCIAL_PREFERENCES].sort())
    expect(Object.keys(MOOD_LABELS).sort()).toEqual([...MOODS].sort())
    expect(Object.keys(SKIP_REASON_LABELS).sort()).toEqual([...SKIP_REASONS].sort())
  })

  it('can only ever produce a profile the server accepts, even with everything selected', () => {
    const result = profileInputSchema.safeParse({
      preferences: {
        likes: INTERESTS.slice(0, 10).map((i) => i.term),
        dislikes: INTERESTS.slice(10, 14).map((i) => i.term),
        preferred_duration_min: DURATION_CHOICES[0],
        social_preference: 'any',
      },
      motivators: [...MOTIVATORS],
      avoidances: [...AVOIDANCES],
      equipment: [...EQUIPMENT],
      best_windows: WINDOW_CHOICES.map((w) => w.window),
    })
    expect(result.success).toBe(true)
  })

  it('offers only durations the server accepts', () => {
    for (const d of DURATION_CHOICES) expect(d).toBeGreaterThanOrEqual(5)
    for (const d of DURATION_CHOICES) expect(d).toBeLessThanOrEqual(300)
  })
})

// --------------------------------------------------------------------------------- session

describe('session id', () => {
  it('is a valid UUID, created once, and kept across calls', () => {
    vi.stubGlobal('localStorage', fakeStorage())
    const a = getSessionId()
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(getSessionId()).toBe(a)
    expect(localStorage.getItem('tg_session_id')).toBe(a)
  })

  it('replaces a corrupted stored value instead of sending garbage to the server', () => {
    const store = fakeStorage()
    store.setItem('tg_session_id', 'not-a-uuid')
    vi.stubGlobal('localStorage', store)
    const id = getSessionId()
    expect(id).not.toBe('not-a-uuid')
    expect(store.getItem('tg_session_id')).toBe(id)
  })

  it('still works when storage is blocked (private mode), staying stable for the visit', () => {
    vi.stubGlobal('localStorage', undefined)
    resetSession()
    const a = getSessionId()
    expect(a).toMatch(/^[0-9a-f-]{36}$/)
    expect(getSessionId()).toBe(a)
  })

  it('resetSession gives a new identity', () => {
    vi.stubGlobal('localStorage', fakeStorage())
    const a = getSessionId()
    resetSession()
    expect(getSessionId()).not.toBe(a)
  })
})

// ------------------------------------------------------------------------------- API client

describe('API client', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', fakeStorage())
  })

  it('sends the session header and a JSON body, and parses the answer', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, MISSION))
    vi.stubGlobal('fetch', fetchMock)
    const out = await recommend({ duration_limit: 60, use_ai: false })
    expect(out.title).toBe('Brisk walk')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/recommend')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['x-session-id']).toBe(getSessionId())
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json')
    expect(JSON.parse(init.body as string)).toEqual({ duration_limit: 60, use_ai: false })
  })

  it('treats the 200 "no profile yet" answer as null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { profile: null })))
    expect(await getProfile()).toBeNull()
  })

  it('still understands the older 404 "no profile yet" answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(404, { error: { code: 'profile_not_found', message: 'No profile yet.' } })))
    expect(await getProfile()).toBeNull()
  })

  it('turns server errors into ApiError with the server code and message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(400, { error: { code: 'invalid_request', message: 'Request validation failed' } })))
    await expect(sendFeedback({ recommendation_id: REC_ID, outcome: 'completed' })).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      code: 'invalid_request',
      message: 'Request validation failed',
    })
  })

  it('reports an unreachable server as a friendly network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    const err = await getHistory().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 0, code: 'network' })
  })

  it('gives up on a hung request instead of waiting forever', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason)))),
    )
    const t0 = Date.now()
    const err = await recommend({ duration_limit: 30 }, AbortSignal.timeout(50)).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(Date.now() - t0).toBeLessThan(1500)
  })

  it('reports a cancelled request as cancelled (so screens can ignore it quietly)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('x'), { name: 'AbortError' }))))),
    )
    const ac = new AbortController()
    const p = upgradeRecommendation(REC_ID, ac.signal)
    ac.abort()
    await expect(p).rejects.toMatchObject({ code: 'cancelled' })
  })

  it('handles a non-JSON error page without crashing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Bad gateway</html>', { status: 502 })))
    await expect(getHistory()).rejects.toMatchObject({ status: 502, code: 'http_error' })
  })

  it('upgrade posts to the right path and returns "not upgraded" as a normal answer', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { upgraded: false, reason: 'ai_unavailable' }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await upgradeRecommendation(REC_ID)
    expect(out).toEqual({ upgraded: false, reason: 'ai_unavailable' })
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(`/api/recommend/${REC_ID}/upgrade`)
  })
})

// ----------------------------------------------------------------------------- mission store

describe('mission store', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', fakeStorage())
  })

  it('round-trips the current mission', () => {
    saveMission({ recommendation: MISSION, stage: 'going', shownAt: 123 })
    expect(loadMission()).toEqual({ recommendation: MISSION, stage: 'going', shownAt: 123 })
    clearMission()
    expect(loadMission()).toBeNull()
  })

  it('ignores corrupted or tampered data', () => {
    for (const bad of ['{not json', '{}', JSON.stringify({ recommendation: { ...MISSION, recommendation_id: 'x' }, stage: 'shown' }), JSON.stringify({ recommendation: MISSION, stage: 'weird' }), JSON.stringify({ recommendation: { ...MISSION, title: 5 }, stage: 'shown' })]) {
      localStorage.setItem('tg_mission', bad)
      expect(loadMission(), bad).toBeNull()
    }
  })

  it('never throws when storage is blocked', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(() => saveMission({ recommendation: MISSION, stage: 'shown', shownAt: 1 })).not.toThrow()
    expect(loadMission()).toBeNull()
    expect(() => clearMission()).not.toThrow()
    expect(hasProfileHint()).toBe(false)
    expect(() => setProfileHint(true)).not.toThrow()
  })

  it('remembers whether a profile exists', () => {
    expect(hasProfileHint()).toBe(false)
    setProfileHint(true)
    expect(hasProfileHint()).toBe(true)
    setProfileHint(false)
    expect(hasProfileHint()).toBe(false)
  })
})

describe('mission clock and side-quest ticks', () => {
  const REC_ID_2 = 'r_11111111-2222-4333-8444-555555555555'
  const rec = { ...MISSION, recommendation_id: REC_ID_2 }

  beforeEach(() => vi.stubGlobal('localStorage', fakeStorage()))

  it('remembers when they set off and which quests they ticked, across reloads', async () => {
    const { setQuestTicked } = await import('./mission-store')
    saveMission({ recommendation: rec, stage: 'going', shownAt: 1, wentAt: 1_000_000, questsTicked: [] })
    expect(setQuestTicked(1, true)).toEqual([false, true])
    expect(loadMission()).toMatchObject({ stage: 'going', wentAt: 1_000_000, questsTicked: [false, true] })
    expect(setQuestTicked(0, true)).toEqual([true, true])
    expect(setQuestTicked(1, false)).toEqual([true, false])
  })

  it('ignores quest ticks when there is no mission, or an impossible position', async () => {
    const { setQuestTicked } = await import('./mission-store')
    expect(setQuestTicked(0, true)).toEqual([])
    saveMission({ recommendation: rec, stage: 'going', shownAt: 1, wentAt: 5 })
    expect(setQuestTicked(-1, true)).toEqual([])
    expect(setQuestTicked(3, true)).toEqual([])
  })

  it('measures minutes away sensibly: whole, never negative, never silly-large', async () => {
    const { minutesAway } = await import('./mission-store')
    expect(minutesAway(null)).toBeNull()
    expect(minutesAway({})).toBeNull()
    expect(minutesAway({ wentAt: 1_000_000 }, 1_000_000 + 41 * 60_000 + 20_000)).toBe(41)
    expect(minutesAway({ wentAt: 1_000_000 }, 1_000_000 - 60_000)).toBe(0) // a clock that moved back
    expect(minutesAway({ wentAt: 1_000_000 }, 1_000_000 + 99 * 24 * 3_600_000)).toBe(24 * 60)
  })

  it('drops a corrupt clock or tick list instead of trusting it', () => {
    localStorage.setItem('tg_mission', JSON.stringify({ recommendation: rec, stage: 'going', shownAt: 1, wentAt: 'yesterday', questsTicked: 'all' }))
    const m = loadMission()!
    expect(m.wentAt).toBeUndefined()
    expect(m.questsTicked).toBeUndefined()
    localStorage.setItem('tg_mission', JSON.stringify({ recommendation: rec, stage: 'going', shownAt: 1, wentAt: -5, questsTicked: [true, 'x', 1, true, true] }))
    const n = loadMission()!
    expect(n.wentAt).toBeUndefined()
    expect(n.questsTicked).toEqual([true, false, false]) // only real booleans count, and at most three
  })
})
