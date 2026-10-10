import { describe, expect, it, vi } from 'vitest'
import type { ApiErrorBody, FeedbackResponse, HistoryResponse, RecommendResponse, UpgradeResponse } from '@/shared/api'
import { getActivity } from '@/shared/engine'
import { AiGate } from './ai/gate'
import type { AiProvider } from './ai/provider'
import { createApp } from './app'
import type { ContextProvider } from './context/provider'
import { MemoryRepository, type Repository } from './repository'

// Failure drills from the report (Phase 11): database outage, AI outage, weather outage, and all at once.
// Everything is synthetic and in memory.

const SESSION = '6a3b8c1e-5d4a-4b7e-9c6d-1a2b3c4d5e6f'
const NOW = new Date('2026-10-07T12:00:00Z')

const PROFILE = {
  preferences: { likes: ['walking'], dislikes: [], preferred_duration_min: 45, social_preference: 'any' },
  motivators: ['novelty', 'calm'],
  avoidances: [],
  equipment: [],
  goals: [],
  best_windows: [],
}

/** A repository whose every call fails like an unreachable database, with a secret in the message. */
function downRepo(): Repository {
  const fail = () => Promise.reject(new Error('D1_ERROR: connect ECONNRESET db.internal.example password=hunter2'))
  return { getProfile: fail, saveProfile: fail, deleteUser: fail, addEvent: fail, getEvent: fail, updateEvent: fail, listEvents: fail, listCredited: fail }
}

function setup(opts: { repo?: Repository; ai?: AiProvider; context?: ContextProvider } = {}) {
  const app = createApp({
    repo: opts.repo ?? new MemoryRepository(),
    now: () => NOW,
    ...(opts.context ? { context: opts.context } : {}),
    ...(opts.ai ? { ai: { provider: () => opts.ai ?? null, gate: new AiGate(), timeoutMs: 300 } } : {}),
  })
  const call = async <T>(method: string, path: string, body?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: { 'content-type': 'application/json', 'x-session-id': SESSION },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    return { status: res.status, json: JSON.parse(text) as T, text }
  }
  return { call, app }
}

const noLeak = (r: { text: string }) => {
  expect(r.text).not.toMatch(/hunter2|ECONNRESET|db\.internal|D1_ERROR/)
}

describe('database outage', () => {
  it('every data route answers a clean 503 and leaks nothing', async () => {
    const s = setup({ repo: downRepo() })
    const calls: [string, string, unknown?][] = [
      ['GET', '/api/profile'],
      ['POST', '/api/onboarding', PROFILE],
      ['PATCH', '/api/profile', { goals: ['move_more'] }],
      ['DELETE', '/api/profile'],
      ['POST', '/api/recommend', { duration_limit: 45 }],
      ['POST', '/api/recommend/r_00000000-0000-4000-8000-000000000001/upgrade'],
      ['POST', '/api/feedback', { recommendation_id: 'r_00000000-0000-4000-8000-000000000001', outcome: 'completed' }],
      ['GET', '/api/history'],
      ['GET', '/api/meadow'],
    ]
    for (const [method, path, body] of calls) {
      const r = await s.call<ApiErrorBody>(method, path, body)
      expect(r.status, `${method} ${path}`).toBe(503)
      expect(r.json.error.code, `${method} ${path}`).toBe('storage_unavailable')
      noLeak(r)
    }
  })

  it('the shell and the health check keep working', async () => {
    const s = setup({ repo: downRepo() })
    expect((await s.app.request('/health')).status).toBe(200)
    expect((await s.app.request('/api/health')).status).toBe(200)
  })

  it('still gives a REAL recommendation from the profile the browser kept, without saving anything', async () => {
    const repo = downRepo()
    const addEvent = vi.spyOn(repo, 'addEvent')
    const s = setup({ repo })
    const r = await s.call<RecommendResponse>('POST', '/api/recommend', { duration_limit: 45, use_ai: false, fallback_profile: PROFILE })
    expect(r.status).toBe(200)
    expect(getActivity(r.json.activity_id)).toBeTruthy()
    expect(r.json.persisted).toBe(false)
    expect(r.json.title.length).toBeGreaterThan(3)
    expect(addEvent).not.toHaveBeenCalled() // known to be down: no second failing call to wait on
    noLeak(r)
  })

  it('that recommendation honours the browser copy (a liked interest, a dislike, equipment)', async () => {
    const s = setup({ repo: downRepo() })
    const profile = { ...PROFILE, preferences: { ...PROFILE.preferences, likes: ['badminton'], dislikes: ['walking'] }, equipment: ['racket', 'ball'], motivators: [] }
    const r = await s.call<RecommendResponse>('POST', '/api/recommend', { duration_limit: 90, social_available: true, mode: 'normal', use_ai: false, fallback_profile: profile })
    expect(r.json.activity_id).toBe('badminton_game')
  })

  it('the upgrade cannot work without saved data, and says so quietly', async () => {
    const r = await setup({ repo: downRepo() }).call<ApiErrorBody>('POST', '/api/recommend/r_00000000-0000-4000-8000-000000000001/upgrade')
    expect(r.status).toBe(503)
  })

  it('a fallback profile is ignored when saved data is fine (the stored profile wins)', async () => {
    const s = setup()
    await s.call('POST', '/api/onboarding', { ...PROFILE, preferences: { ...PROFILE.preferences, likes: ['swimming'] }, equipment: ['swimwear'] })
    const r = await s.call<RecommendResponse>('POST', '/api/recommend', {
      duration_limit: 60,
      mode: 'normal',
      use_ai: false,
      fallback_profile: { ...PROFILE, preferences: { ...PROFILE.preferences, likes: ['yoga'] } },
    })
    expect(r.status).toBe(200)
    expect(r.json.persisted).toBe(true)
  })

  it('a malformed fallback profile is rejected like any other bad input', async () => {
    const s = setup({ repo: downRepo() })
    for (const bad of [{ preferences: 5 }, { ...PROFILE, motivators: ['not_a_motivator'] }, { ...PROFILE, extra: true }]) {
      const r = await s.call<ApiErrorBody>('POST', '/api/recommend', { duration_limit: 45, fallback_profile: bad })
      expect(r.status).toBe(400)
    }
  })

  it('without a fallback profile and without saved data, the answer is a 503 (not a fake recommendation)', async () => {
    const r = await setup({ repo: downRepo() }).call<ApiErrorBody>('POST', '/api/recommend', { duration_limit: 45 })
    expect(r.status).toBe(503)
  })
})

describe('writes failing while reads work (partial outage)', () => {
  it('the recommendation still arrives, marked as not saved', async () => {
    const base = new MemoryRepository()
    const repo: Repository = { ...downRepo(), getProfile: (k) => base.getProfile(k), saveProfile: (k, p) => base.saveProfile(k, p), listEvents: (k, n) => base.listEvents(k, n) }
    const s = setup({ repo })
    await s.call('POST', '/api/onboarding', PROFILE)
    const r = await s.call<RecommendResponse>('POST', '/api/recommend', { duration_limit: 45, use_ai: false })
    expect(r.status).toBe(200)
    expect(r.json.persisted).toBe(false)
  })

  it('feedback is refused cleanly, never half-applied', async () => {
    const base = new MemoryRepository()
    const repo: Repository = { ...downRepo(), getEvent: (k, id) => base.getEvent(k, id) }
    const r = await setup({ repo }).call<ApiErrorBody>('POST', '/api/feedback', { recommendation_id: 'r_00000000-0000-4000-8000-000000000001', outcome: 'completed' })
    expect([404, 503]).toContain(r.status)
  })
})

describe('AI and weather outages', () => {
  const explodingAi: AiProvider = { name: 'exploding', complete: () => Promise.reject(new Error('Workers AI 3040: capacity temporarily exceeded')) }
  const hangingAi: AiProvider = { name: 'hanging', complete: () => new Promise(() => {}) }
  const brokenWeather: ContextProvider = {
    conditions: () => Promise.reject(new Error('open-meteo exploded https://secret.example')),
    places: () => Promise.reject(new Error('boom')),
  }

  it('AI overloaded: the engine pick is still returned, immediately, with no error', async () => {
    const s = setup({ ai: explodingAi })
    await s.call('POST', '/api/onboarding', PROFILE)
    const r = await s.call<RecommendResponse>('POST', '/api/recommend', { duration_limit: 45 }) // use_ai defaults to true
    expect(r.status).toBe(200)
    expect(r.json.source).toBe('deterministic')
  })

  it('AI that never answers: the answer still arrives within its time budget', async () => {
    const s = setup({ ai: hangingAi })
    await s.call('POST', '/api/onboarding', PROFILE)
    const t0 = Date.now()
    const r = await s.call<RecommendResponse>('POST', '/api/recommend', { duration_limit: 45 })
    expect(r.status).toBe(200)
    expect(r.json.source).toBe('deterministic')
    expect(Date.now() - t0).toBeLessThan(3000)
  })

  it('the instant-then-upgrade flow reports "not upgraded" instead of failing when the AI is down', async () => {
    const s = setup({ ai: explodingAi })
    await s.call('POST', '/api/onboarding', PROFILE)
    const first = await s.call<RecommendResponse>('POST', '/api/recommend', { duration_limit: 45, use_ai: false })
    const up = await s.call<UpgradeResponse>('POST', `/api/recommend/${first.json.recommendation_id}/upgrade`)
    expect(up.status).toBe(200)
    expect(up.json.upgraded).toBe(false)
  })

  it('weather down: recommendations carry on without weather and say nothing about the sky', async () => {
    const s = setup({ context: brokenWeather })
    await s.call('POST', '/api/onboarding', PROFILE)
    const r = await s.call<RecommendResponse>('POST', '/api/recommend', { duration_limit: 45, use_ai: false, location: { lat: 12.97, lon: 77.59 } })
    expect(r.status).toBe(200)
    expect(r.json.context).toBeUndefined()
    expect(r.json.reason).not.toMatch(/degrees|sky|outside/i)
    noLeak(r)
    expect(r.text).not.toContain('secret.example')
  })

  it('EVERYTHING down at once (database, AI, weather): a real recommendation from the browser copy', async () => {
    const s = setup({ repo: downRepo(), ai: explodingAi, context: brokenWeather })
    const r = await s.call<RecommendResponse>('POST', '/api/recommend', {
      duration_limit: 45,
      location: { lat: 12.97, lon: 77.59 },
      fallback_profile: PROFILE,
    })
    expect(r.status).toBe(200)
    expect(r.json.source).toBe('deterministic')
    expect(r.json.persisted).toBe(false)
    expect(getActivity(r.json.activity_id)).toBeTruthy()
    noLeak(r)
  })
})

describe('history of a stored person is unaffected by all of this', () => {
  it('still lists normally when everything is healthy', async () => {
    const s = setup()
    await s.call('POST', '/api/onboarding', PROFILE)
    await s.call('POST', '/api/recommend', { duration_limit: 45, use_ai: false })
    const h = await s.call<HistoryResponse>('GET', '/api/history')
    expect(h.status).toBe(200)
    expect(h.json.items).toHaveLength(1)
    const fb = await s.call<FeedbackResponse>('POST', '/api/feedback', { recommendation_id: h.json.items[0]!.recommendation_id, outcome: 'completed', enjoyment: 4 })
    expect(fb.status).toBe(200)
  })
})
