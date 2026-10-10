import { describe, expect, it } from 'vitest'
import type { ApiErrorBody, FeedbackResponse, RecommendResponse } from '@/shared/api'
import type { MeadowSummary } from '@/shared/meadow'
import { createApp } from './app'
import { MemoryRepository } from './repository'

// Synthetic users, in memory. Time moves one minute per call so history is ordered, from a fixed start.

const A = '7a3b8c1e-5d4a-4b7e-9c6d-1a2b3c4d5e6f'
const B = '8a3b8c1e-5d4a-4b7e-9c6d-1a2b3c4d5e6f'
const PROFILE = {
  preferences: { likes: ['walking'], dislikes: [], preferred_duration_min: 45, social_preference: 'any' },
  motivators: ['novelty'],
  avoidances: [],
  equipment: [],
  best_windows: [],
}

function setup() {
  let t = new Date('2026-10-07T12:00:00Z').getTime()
  const repo = new MemoryRepository()
  const app = createApp({
    repo,
    now: () => {
      t += 60_000
      return new Date(t)
    },
  })
  const call = async <T>(method: string, path: string, body?: unknown, session = A) => {
    const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-session-id': session }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: (await res.json()) as T }
  }
  return { call, repo }
}
type S = ReturnType<typeof setup>

async function onboarded(session = A) {
  const s = setup()
  expect((await s.call('POST', '/api/onboarding', PROFILE, session)).status).toBe(200)
  return s
}
const rec = (s: S, over: Record<string, unknown> = {}, session = A) =>
  s.call<RecommendResponse>('POST', '/api/recommend', { duration_limit: 60, mode: 'normal', use_ai: false, utc_offset_minutes: 330, ...over }, session)
const answer = (s: S, id: string, body: Record<string, unknown>, session = A) =>
  s.call<FeedbackResponse & ApiErrorBody>('POST', '/api/feedback', { recommendation_id: id, ...body }, session)
const meadow = (s: S, qs = '?utc_offset_minutes=330', session = A) => s.call<MeadowSummary>('GET', `/api/meadow${qs}`, undefined, session)

describe('feedback rewards', () => {
  it('a completed mission credits the real time outside and earns a first milestone', async () => {
    const s = await onboarded()
    const r = await rec(s)
    const f = await answer(s, r.json.recommendation_id, { outcome: 'completed', enjoyment: 4, minutes_outside: 25, quests_done: 2 })
    expect(f.status).toBe(200)
    expect(f.json.reward).toMatchObject({ credited_minutes: 25, total_minutes: 25, missions: 1, quests_done: 2 })
    expect(f.json.reward!.new_milestones.map((m) => m.id)).toEqual(['first_step', 'evening_out']) // 17:30 local: also an evening
  })

  it('credits the plan when no time was measured, and half of it for part of it', async () => {
    const s = await onboarded()
    const planned = (await rec(s)).json
    const full = await answer(s, planned.recommendation_id, { outcome: 'completed' })
    expect(full.json.reward!.credited_minutes).toBe(planned.duration_min)
    const second = (await rec(s)).json
    const part = await answer(s, second.recommendation_id, { outcome: 'partial' })
    expect(part.json.reward!.credited_minutes).toBe(Math.round(second.duration_min / 2))
  })

  it('cannot be inflated: absurd minutes are capped at 1.5x the plan', async () => {
    const s = await onboarded()
    const r = (await rec(s)).json
    const f = await answer(s, r.recommendation_id, { outcome: 'completed', minutes_outside: 480 })
    expect(f.json.reward!.credited_minutes).toBe(Math.max(15, Math.round(r.duration_min * 1.5)))
  })

  it('celebrates a milestone exactly once', async () => {
    const s = await onboarded()
    const first = await answer(s, (await rec(s)).json.recommendation_id, { outcome: 'completed', minutes_outside: 40 })
    expect(first.json.reward!.new_milestones.map((m) => m.id)).toContain('first_step')
    const second = await answer(s, (await rec(s)).json.recommendation_id, { outcome: 'completed', minutes_outside: 40 })
    expect(second.json.reward!.new_milestones.map((m) => m.id)).not.toContain('first_step')
    expect(second.json.reward!.new_milestones.map((m) => m.id)).toContain('hour_out')
    const third = await answer(s, (await rec(s)).json.recommendation_id, { outcome: 'completed', minutes_outside: 5 })
    expect(third.json.reward!.new_milestones.map((m) => m.id)).not.toContain('hour_out')
  })

  it('answering the same mission twice neither double-counts nor celebrates twice', async () => {
    const s = await onboarded()
    const r = (await rec(s)).json
    const one = await answer(s, r.recommendation_id, { outcome: 'completed', minutes_outside: 20 })
    const two = await answer(s, r.recommendation_id, { outcome: 'completed', minutes_outside: 20 })
    expect(one.json.reward!.new_milestones.map((m) => m.id)).toContain('first_step')
    expect(two.json.reward!.new_milestones).toEqual([])
    expect(two.json.reward!.total_minutes).toBe(20)
    expect(two.json.reward!.missions).toBe(1)
  })

  it('a skip or a swap carries no reward and nothing is taken away', async () => {
    const s = await onboarded()
    await answer(s, (await rec(s)).json.recommendation_id, { outcome: 'completed', minutes_outside: 30 })
    const skipped = await answer(s, (await rec(s)).json.recommendation_id, { outcome: 'skipped', skip_reason: 'too_tired' })
    expect(skipped.status).toBe(200)
    expect(skipped.json.reward).toBeUndefined()
    const m = (await meadow(s)).json
    expect(m.total_minutes).toBe(30)
    expect(m.missions).toBe(1)
  })

  it('rejects minutes or quests on an outcome that is not completed or partial', async () => {
    const s = await onboarded()
    for (const outcome of ['skipped', 'changed'] as const) {
      const r = (await rec(s)).json
      expect((await answer(s, r.recommendation_id, { outcome, minutes_outside: 10 })).status).toBe(400)
      expect((await answer(s, r.recommendation_id, { outcome, quests_done: 1 })).status).toBe(400)
    }
  })

  it('rejects impossible numbers', async () => {
    const s = await onboarded()
    const r = (await rec(s)).json
    for (const bad of [{ minutes_outside: 481 }, { minutes_outside: -1 }, { minutes_outside: 12.5 }, { minutes_outside: '30' }, { quests_done: 4 }, { quests_done: -1 }, { quests_done: 1.5 }]) {
      expect((await answer(s, r.recommendation_id, { outcome: 'completed', ...bad })).status, JSON.stringify(bad)).toBe(400)
    }
  })

  it('accepts zero (a real value), and a change of mind replaces the earlier numbers', async () => {
    const s = await onboarded()
    const r = (await rec(s)).json
    await answer(s, r.recommendation_id, { outcome: 'completed', minutes_outside: 30, quests_done: 2 })
    const f = await answer(s, r.recommendation_id, { outcome: 'partial', minutes_outside: 0, quests_done: 0 })
    expect(f.status).toBe(200)
    expect((await meadow(s)).json.quests_done).toBe(0)
  })

  it('never leaks to another session', async () => {
    const s = await onboarded()
    await answer(s, (await rec(s)).json.recommendation_id, { outcome: 'completed', minutes_outside: 30 })
    await s.call('POST', '/api/onboarding', PROFILE, B)
    expect((await meadow(s, '', B)).json.total_minutes).toBe(0)
    expect((await meadow(s, '', A)).json.total_minutes).toBe(30)
  })
})

describe('GET /api/meadow', () => {
  it('starts as a calm empty meadow', async () => {
    const s = await onboarded()
    const m = (await meadow(s)).json
    expect(m).toMatchObject({ total_minutes: 0, missions: 0, quests_done: 0, flowers: [] })
    expect(m.week.days).toHaveLength(7)
    expect(m.milestones.every((x) => !x.earned)).toBe(true)
    expect(m.next).toBeTruthy()
  })

  it('adds up real answers: minutes, missions, flowers by kind, earned milestones with their moment', async () => {
    const s = await onboarded()
    await answer(s, (await rec(s)).json.recommendation_id, { outcome: 'completed', minutes_outside: 30, quests_done: 1 })
    await answer(s, (await rec(s)).json.recommendation_id, { outcome: 'completed', minutes_outside: 30, quests_done: 2 })
    const m = (await meadow(s)).json
    expect(m.total_minutes).toBe(60)
    expect(m.missions).toBe(2)
    expect(m.quests_done).toBe(3)
    expect(m.flowers).toHaveLength(2)
    const hour = m.milestones.find((x) => x.id === 'hour_out')!
    expect(hour.earned).toBe(true)
    expect(hour.earned_at).toMatch(/^2026-10-07T\d{2}:\d{2}:\d{2}\+05:30$/)
  })

  it("puts today at the end of the week in the person's own time zone", async () => {
    const s = await onboarded()
    await answer(s, (await rec(s)).json.recommendation_id, { outcome: 'completed', minutes_outside: 30 })
    const india = (await meadow(s, '?utc_offset_minutes=330')).json
    expect(india.week.days[6]!.date).toBe('2026-10-07')
    expect(india.week.days[6]!.minutes).toBe(30)
    expect(india.week.minutes).toBe(30)
    const farWest = (await meadow(s, '?utc_offset_minutes=-780')).json
    expect(farWest.week.days[6]!.date).toBe('2026-10-06') // it is still yesterday at UTC-13
  })

  it('validates its query and needs a session', async () => {
    const s = await onboarded()
    expect((await meadow(s, '?utc_offset_minutes=9999')).status).toBe(400)
    expect((await meadow(s, '?utc_offset_minutes=abc')).status).toBe(400)
    const res = await s.call<ApiErrorBody>('GET', '/api/meadow', undefined, 'not-a-uuid')
    expect(res.status).toBe(401)
  })

  it('credits an older event that has no planned or measured time from the activity default (nothing is lost)', async () => {
    const s = await onboarded()
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(A))
    const userKey = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
    await s.repo.addEvent(userKey, {
      recommendation_id: 'r_00000000-0000-4000-8000-000000000001',
      activity_id: 'brisk_walk_loop',
      timestamp: '2026-09-01T18:00:00+05:30',
      outcome: 'completed',
      context: { duration_limit: 60, mood: 'ok', social_available: false, hour: 18 },
    })
    const m = (await meadow(s)).json
    expect(m.missions).toBe(1)
    expect(m.total_minutes).toBeGreaterThan(0)
    expect(m.milestones.find((x) => x.id === 'evening_out')!.earned).toBe(true)
  })

  it('completed missions survive any amount of later activity (the meadow only grows)', async () => {
    const s = await onboarded()
    await answer(s, (await rec(s)).json.recommendation_id, { outcome: 'completed', minutes_outside: 30 })
    let last = (await meadow(s)).json.total_minutes
    for (let i = 0; i < 6; i++) {
      const r = (await rec(s)).json
      await answer(s, r.recommendation_id, i % 2 ? { outcome: 'skipped' } : { outcome: 'completed', minutes_outside: 5 })
      const now = (await meadow(s)).json.total_minutes
      expect(now).toBeGreaterThanOrEqual(last)
      last = now
    }
  })
})
