import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { ApiErrorBody, FeedbackResponse, HistoryResponse, ProfileResponse, RecommendResponse } from '@/shared/api'
import { getActivity } from '@/shared/engine'
import { createApp } from './app'
import type { Repository, StoredEvent } from './repository'
import { makeHarness, STORAGE_KINDS, type Harness } from './test-support'
import { localClock, offsetFromTimeZone } from './time'

// ------------------------------------------------------------------ helpers
// All users/profiles here are synthetic test data.

const SESSION_A = '3f2b8c1e-5d4a-4b7e-9c6d-1a2b3c4d5e6f'
const SESSION_B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'
const NOON_UTC = new Date('2026-10-07T12:00:00Z')

const validProfile = {
  preferences: { likes: ['Walking', 'walking', 'photography'], dislikes: ['Running'], preferred_duration_min: 45, social_preference: 'any' },
  motivators: ['novelty', 'calm', 'novelty'],
  avoidances: [],
  equipment: ['racket'],
  best_windows: ['17:30-19:30'],
}

// The harness for the storage backend currently under test (set in beforeAll below).
let current: Harness

function setup(opts: { repo?: Repository; now?: () => Date } = {}) {
  const repo = opts.repo ?? current.create()
  const app = createApp({ repo, now: opts.now ?? (() => NOON_UTC) })
  const call = async <T = unknown>(
    method: string,
    path: string,
    o: { session?: string | null; body?: unknown; raw?: string } = {},
  ) => {
    const headers: Record<string, string> = {}
    const session = o.session === undefined ? SESSION_A : o.session
    if (session !== null) headers['x-session-id'] = session
    let body: string | undefined
    if (o.raw !== undefined) body = o.raw
    else if (o.body !== undefined) body = JSON.stringify(o.body)
    if (body !== undefined) headers['content-type'] = 'application/json'
    const res = await app.request(path, { method, headers, body })
    const text = await res.text()
    return { status: res.status, headers: res.headers, json: (text ? JSON.parse(text) : null) as T }
  }
  return { app, repo, call }
}

type Call = ReturnType<typeof setup>['call']
const onboard = (call: Call, session?: string) => call<ProfileResponse>('POST', '/api/onboarding', { session, body: validProfile })

// ------------------------------------------------------------------ tests

describe.each(STORAGE_KINDS)('API on %s storage', (kind) => {
  beforeAll(async () => {
    current = await makeHarness(kind)
  }, 60_000)
  afterAll(async () => {
    await current.dispose()
  })
  beforeEach(async () => {
    await current.reset()
  })

  describe('health and platform behaviour', () => {
    it('answers /health and /api/health without a session', async () => {
      const { call } = setup()
      for (const path of ['/health', '/api/health']) {
        const r = await call<{ status: string }>('GET', path, { session: null })
        expect(r.status).toBe(200)
        expect(r.json.status).toBe('ok')
      }
    })

    it('sets security headers and forbids caching of API responses', async () => {
      const { call } = setup()
      const r = await call('GET', '/api/profile')
      expect(r.headers.get('cache-control')).toBe('no-store')
      expect(r.headers.get('x-content-type-options')).toBe('nosniff')
    })

    it('returns JSON 404 for unknown endpoints', async () => {
      const { call } = setup()
      const r = await call<ApiErrorBody>('GET', '/api/does-not-exist')
      expect(r.status).toBe(404)
      expect(r.json.error.code).toBe('not_found')
    })

    it('rejects oversized bodies', async () => {
      const { call } = setup()
      const r = await call<ApiErrorBody>('POST', '/api/onboarding', { raw: JSON.stringify({ pad: 'x'.repeat(20_000) }) })
      expect(r.status).toBe(413)
      expect(r.json.error.code).toBe('payload_too_large')
    })

    it('handles malformed JSON as a 400, not a crash', async () => {
      const { call } = setup()
      const r = await call<ApiErrorBody>('POST', '/api/onboarding', { raw: '{not json' })
      expect(r.status).toBe(400)
      expect(r.json.error.code).toBe('invalid_request')
    })
  })

  describe('sessions', () => {
    it('requires a well-formed session id on /api routes', async () => {
      const { call } = setup()
      for (const session of [null, 'abc', '12345', 'not-a-uuid-at-all']) {
        const r = await call<ApiErrorBody>('GET', '/api/profile', { session })
        expect(r.status, String(session)).toBe(401)
        expect(r.json.error.code).toBe('session_required')
      }
    })

    it("keeps each session's data private", async () => {
      const { call } = setup()
      await onboard(call, SESSION_A)
      const other = await call<ApiErrorBody>('GET', '/api/profile', { session: SESSION_B })
      expect(other.status).toBe(404)
      expect(other.json.error.code).toBe('profile_not_found')
    })

    it("one session cannot give feedback on another session's recommendation", async () => {
      const { call } = setup()
      await onboard(call, SESSION_A)
      await onboard(call, SESSION_B)
      const rec = await call<RecommendResponse>('POST', '/api/recommend', { session: SESSION_A, body: { duration_limit: 60 } })
      const stolen = await call<ApiErrorBody>('POST', '/api/feedback', {
        session: SESSION_B,
        body: { recommendation_id: rec.json.recommendation_id, outcome: 'completed' },
      })
      expect(stolen.status).toBe(404)
      expect(stolen.json.error.code).toBe('recommendation_not_found')
    })

    it('stores only a hash of the session id', async () => {
      const { call } = setup()
      await onboard(call)
      const keys = await current.profileKeys()
      expect(keys).toHaveLength(1)
      expect(keys[0]).toMatch(/^[0-9a-f]{64}$/)
      expect(keys[0]).not.toContain(SESSION_A)
    })
  })

  describe('onboarding and profile', () => {
    it('normalises terms, removes duplicates and returns the stored profile', async () => {
      const { call } = setup()
      const r = await onboard(call)
      expect(r.status).toBe(200)
      expect(r.json.profile.preferences.likes).toEqual(['walking', 'photography'])
      expect(r.json.profile.preferences.dislikes).toEqual(['running'])
      expect(r.json.profile.motivators).toEqual(['novelty', 'calm'])
      expect(r.json.profile.schedule_signals.best_windows).toEqual(['17:30-19:30'])
      expect(r.json.stats.completion_rate).toBeNull()
    })

    it('rejects invalid input with field-level details', async () => {
      const { call } = setup()
      const bad = {
        preferences: { likes: [], dislikes: [], preferred_duration_min: 2, social_preference: 'everyone' },
        motivators: ['fame'],
        avoidances: [],
        equipment: ['jetpack'],
        best_windows: ['25:99-26:00'],
      }
      const r = await call<ApiErrorBody>('POST', '/api/onboarding', { body: bad })
      expect(r.status).toBe(400)
      const paths = (r.json.error.details ?? []).map((d) => d.path)
      expect(paths).toContain('preferences.preferred_duration_min')
      expect(paths).toContain('preferences.social_preference')
      expect(paths).toContain('equipment.0')
      expect(paths).toContain('motivators.0')
      expect(paths).toContain('best_windows.0')
    })

    it('rejects unknown fields instead of silently ignoring them', async () => {
      const { call } = setup()
      const r = await call<ApiErrorBody>('POST', '/api/onboarding', { body: { ...validProfile, is_admin: true } })
      expect(r.status).toBe(400)
    })

    it('patches part of a profile and keeps the rest', async () => {
      const { call } = setup()
      await onboard(call)
      const r = await call<ProfileResponse>('PATCH', '/api/profile', { body: { preferences: { preferred_duration_min: 20 }, equipment: ['ball'] } })
      expect(r.status).toBe(200)
      expect(r.json.profile.preferences.preferred_duration_min).toBe(20)
      expect(r.json.profile.preferences.likes).toEqual(['walking', 'photography'])
      expect(r.json.profile.equipment).toEqual(['ball'])
    })

    it('patch before onboarding is a 404', async () => {
      const { call } = setup()
      const r = await call<ApiErrorBody>('PATCH', '/api/profile', { body: { equipment: [] } })
      expect(r.status).toBe(404)
    })

    it('deletes everything about a user', async () => {
      const { call } = setup()
      await onboard(call)
      await call('POST', '/api/recommend', { body: { duration_limit: 60 } })
      expect((await call('DELETE', '/api/profile')).status).toBe(200)
      expect((await call('GET', '/api/profile')).status).toBe(404)
      expect((await call<HistoryResponse>('GET', '/api/history')).json.items).toEqual([])
    })
  })

  describe('recommend', () => {
    it('needs onboarding first', async () => {
      const { call } = setup()
      const r = await call<ApiErrorBody>('POST', '/api/recommend', { body: { duration_limit: 60 } })
      expect(r.status).toBe(404)
      expect(r.json.error.code).toBe('profile_not_found')
    })

    it('returns a complete, valid recommendation that respects the profile and time limit', async () => {
      const { call } = setup()
      await onboard(call)
      const r = await call<RecommendResponse>('POST', '/api/recommend', { body: { duration_limit: 30, mood: 'low', social_available: false } })
      expect(r.status).toBe(200)
      const rec = r.json
      expect(rec.recommendation_id).toMatch(/^r_[0-9a-f-]{36}$/)
      expect(rec.title.length).toBeGreaterThan(3)
      expect(rec.first_step.length).toBeGreaterThan(10)
      expect(rec.reason.length).toBeGreaterThan(5)
      expect(rec.duration_min).toBeLessThanOrEqual(30)
      expect(rec.source).toBe('deterministic')
      expect(rec.persisted).toBe(true)
      const activity = getActivity(rec.activity_id)!
      expect(activity.needsOthers).toBe(false) // nobody is free
      expect(activity.tags).not.toContain('running') // explicit dislike
    })

    it('validates the request body', async () => {
      const { call } = setup()
      await onboard(call)
      for (const body of [{}, { duration_limit: 1 }, { duration_limit: 60, mood: 'angry' }, { duration_limit: 60, weather: 'rain' }]) {
        const r = await call<ApiErrorBody>('POST', '/api/recommend', { body })
        expect(r.status, JSON.stringify(body)).toBe(400)
      }
    })

    it("uses the user's local time of day, not the server's", async () => {
      // 20:30 UTC is 02:00 the next day at +05:30: too late to send anyone travelling.
      const { call } = setup({ now: () => new Date('2026-10-07T20:30:00Z') })
      await onboard(call)
      const r = await call<RecommendResponse>('POST', '/api/recommend', { body: { duration_limit: 120, utc_offset_minutes: 330 } })
      expect(getActivity(r.json.activity_id)!.travel).toBe('none')
      const hist = await call<HistoryResponse>('GET', '/api/history')
      expect(hist.json.items[0]?.timestamp).toBe('2026-10-08T02:00:00+05:30')
    })

    it('still answers when storage fails while saving the event', async () => {
      const base = current.create()
      const flaky: Repository = {
        getProfile: (k) => base.getProfile(k),
        saveProfile: (k, p) => base.saveProfile(k, p),
        deleteUser: (k) => base.deleteUser(k),
        addEvent: () => Promise.reject(new Error('database down')),
        getEvent: (k, id) => base.getEvent(k, id),
        updateEvent: (k, e) => base.updateEvent(k, e),
        listEvents: (k, n) => base.listEvents(k, n),
      }
      const { call } = setup({ repo: flaky })
      await onboard(call)
      const r = await call<RecommendResponse>('POST', '/api/recommend', { body: { duration_limit: 60 } })
      expect(r.status).toBe(200)
      expect(r.json.persisted).toBe(false)
      expect(r.json.title.length).toBeGreaterThan(3)
    })

    it('never leaks internals on unexpected errors', async () => {
      const base = current.create()
      const broken: Repository = {
        getProfile: () => Promise.reject(new Error('mongodb://user:secret@host/db exploded')),
        saveProfile: (k, p) => base.saveProfile(k, p),
        deleteUser: (k) => base.deleteUser(k),
        addEvent: (k, e) => base.addEvent(k, e),
        getEvent: (k, id) => base.getEvent(k, id),
        updateEvent: (k, e) => base.updateEvent(k, e),
        listEvents: (k, n) => base.listEvents(k, n),
      }
      const { call } = setup({ repo: broken })
      const r = await call<ApiErrorBody>('POST', '/api/recommend', { body: { duration_limit: 60 } })
      expect(r.status).toBe(500)
      expect(JSON.stringify(r.json)).not.toContain('secret')
      expect(r.json.error.code).toBe('internal_error')
    })
  })

  describe('feedback and learning', () => {
    async function recommend(call: Call, body: Record<string, unknown> = { duration_limit: 60 }) {
      return (await call<RecommendResponse>('POST', '/api/recommend', { body })).json
    }

    it('records the outcome and shows it in history and stats', async () => {
      const { call } = setup()
      await onboard(call)
      const rec = await recommend(call)
      const fb = await call<FeedbackResponse>('POST', '/api/feedback', { body: { recommendation_id: rec.recommendation_id, outcome: 'completed', enjoyment: 5 } })
      expect(fb.status).toBe(200)
      expect(fb.json).toMatchObject({ outcome: 'completed', enjoyment: 5, skip_reason: null })

      const hist = await call<HistoryResponse>('GET', '/api/history')
      expect(hist.json.items[0]).toMatchObject({ recommendation_id: rec.recommendation_id, outcome: 'completed', enjoyment: 5 })
      expect(hist.json.items[0]?.title).toBe(rec.title)

      const prof = await call<ProfileResponse>('GET', '/api/profile')
      expect(prof.json.stats).toEqual({ recommendations: 1, responded: 1, completed: 1, completion_rate: 1 })
    })

    it('lets the user correct their answer', async () => {
      const { call } = setup()
      await onboard(call)
      const rec = await recommend(call)
      await call('POST', '/api/feedback', { body: { recommendation_id: rec.recommendation_id, outcome: 'skipped', skip_reason: 'too_tired' } })
      const fix = await call<FeedbackResponse>('POST', '/api/feedback', { body: { recommendation_id: rec.recommendation_id, outcome: 'partial', enjoyment: 3 } })
      expect(fix.json).toMatchObject({ outcome: 'partial', enjoyment: 3, skip_reason: null })
    })

    it('rejects contradictory feedback', async () => {
      const { call } = setup()
      await onboard(call)
      const rec = await recommend(call)
      const id = rec.recommendation_id
      for (const body of [
        { recommendation_id: id, outcome: 'skipped', enjoyment: 5 },
        { recommendation_id: id, outcome: 'completed', skip_reason: 'boring' },
        { recommendation_id: id, outcome: 'completed', enjoyment: 9 },
        { recommendation_id: id, outcome: 'abandoned' },
        { recommendation_id: 'r_bad', outcome: 'completed' },
      ]) {
        const r = await call<ApiErrorBody>('POST', '/api/feedback', { body })
        expect(r.status, JSON.stringify(body)).toBe(400)
      }
    })

    it('404s for a recommendation that does not exist', async () => {
      const { call } = setup()
      await onboard(call)
      const r = await call<ApiErrorBody>('POST', '/api/feedback', {
        body: { recommendation_id: `r_${crypto.randomUUID()}`, outcome: 'completed' },
      })
      expect(r.status).toBe(404)
    })

    it('feedback changes the next recommendation (the full loop through the API)', async () => {
      const { call } = setup()
      await onboard(call)
      const first = await recommend(call)

      // The user keeps skipping what they were given because it bores them.
      for (let i = 0; i < 2; i++) {
        const rec = await recommend(call)
        if (rec.activity_id !== first.activity_id) break
        await call('POST', '/api/feedback', { body: { recommendation_id: rec.recommendation_id, outcome: 'skipped', skip_reason: 'boring' } })
      }
      const after = await recommend(call)
      expect(after.activity_id).not.toBe(first.activity_id)
    })

    it('only answered recommendations teach the engine (pending ones do not)', async () => {
      const { call, repo } = setup()
      await onboard(call)
      await recommend(call)
      await recommend(call)
      const events = (await repo.listEvents((await keyOf(SESSION_A)), 10)) as StoredEvent[]
      expect(events.every((e) => e.outcome === 'pending')).toBe(true)
    })
  })

  describe('history', () => {
    it('limits and orders newest first, and validates the limit', async () => {
      const { call } = setup()
      await onboard(call)
      for (let i = 0; i < 3; i++) await call('POST', '/api/recommend', { body: { duration_limit: 60 } })
      const two = await call<HistoryResponse>('GET', '/api/history?limit=2')
      expect(two.json.items).toHaveLength(2)
      expect((await call('GET', '/api/history?limit=0')).status).toBe(400)
      expect((await call('GET', '/api/history?limit=1000')).status).toBe(400)
    })
  })

  describe('time helpers', () => {
    it('builds local ISO strings with the offset', () => {
      expect(localClock(new Date('2026-10-07T12:12:00Z'), 330)).toEqual({ hour: 17, iso: '2026-10-07T17:42:00+05:30' })
      expect(localClock(new Date('2026-10-07T03:00:00Z'), -300)).toEqual({ hour: 22, iso: '2026-10-06T22:00:00-05:00' })
      expect(localClock(new Date('2026-10-07T12:00:00Z'), 0).iso).toBe('2026-10-07T12:00:00+00:00')
    })

    it('reads offsets from IANA zones and rejects unknown ones', () => {
      const at = new Date('2026-10-07T12:00:00Z')
      expect(offsetFromTimeZone('Asia/Kolkata', at)).toBe(330)
      expect(offsetFromTimeZone('UTC', at)).toBe(0)
      expect(offsetFromTimeZone('Not/AZone', at)).toBeNull()
    })
  })
})

async function keyOf(session: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(session))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
