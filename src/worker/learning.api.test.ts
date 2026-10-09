import { describe, expect, it } from 'vitest'
import type { ApiErrorBody, FeedbackResponse, ProfileResponse, RecommendResponse, UpgradeResponse } from '@/shared/api'
import { getActivity } from '@/shared/engine'
import { AiGate } from './ai/gate'
import type { AiCompletion, AiProvider, AiRequest } from './ai/provider'
import { createApp } from './app'
import { MemoryRepository } from './repository'

// Synthetic user; the whole loop runs in memory (no network, no database).

const SESSION = '4a3b8c1e-5d4a-4b7e-9c6d-1a2b3c4d5e6f'
let clock = new Date('2026-10-07T12:00:00Z')

const PROFILE = {
  preferences: { likes: ['walking', 'badminton'], dislikes: [], preferred_duration_min: 45, social_preference: 'any' },
  motivators: ['novelty'],
  avoidances: [],
  equipment: ['racket', 'ball'],
  best_windows: [],
}

async function userKey(): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(SESSION))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function setup(ai?: AiProvider) {
  const repo = new MemoryRepository()
  const app = createApp({
    repo,
    now: () => {
      clock = new Date(clock.getTime() + 60_000) // each call is a minute later, so history is ordered
      return clock
    },
    ...(ai ? { ai: { provider: () => ai, gate: new AiGate(), timeoutMs: 500 } } : {}),
  })
  const call = async <T>(method: string, path: string, body?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: { 'content-type': 'application/json', 'x-session-id': SESSION },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: res.status, json: (await res.json()) as T }
  }
  return { call, repo }
}
type S = ReturnType<typeof setup>

const rec = (s: S, over: Record<string, unknown> = {}) =>
  s.call<RecommendResponse>('POST', '/api/recommend', { duration_limit: 90, mood: 'ok', social_available: true, use_ai: false, ...over })

async function answer(s: S, id: string, body: Record<string, unknown>) {
  const r = await s.call<FeedbackResponse>('POST', '/api/feedback', { recommendation_id: id, ...body })
  expect(r.status).toBe(200)
}

async function onboarded(profile: Record<string, unknown> = PROFILE) {
  const s = setup()
  expect((await s.call('POST', '/api/onboarding', profile)).status).toBe(200)
  return s
}

describe('the size of the day', () => {
  it('is normal by default for a fresh person', async () => {
    const r = await rec(await onboarded())
    expect(r.json.mode).toBe('normal')
  })

  it('becomes a small start after two skips in a row, and says why without guilt', async () => {
    const s = await onboarded()
    for (let i = 0; i < 2; i++) {
      const r = await rec(s)
      await answer(s, r.json.recommendation_id, { outcome: 'skipped', skip_reason: 'too_tired' })
    }
    const next = await rec(s)
    expect(next.json.mode).toBe('minimum')
    expect(next.json.reason).toContain('small on purpose')
    expect(next.json.duration_min).toBe(getActivity(next.json.activity_id)!.duration.min)
  })

  it('recovers: one completed activity ends the small-start streak', async () => {
    const s = await onboarded()
    for (let i = 0; i < 2; i++) {
      const r = await rec(s)
      await answer(s, r.json.recommendation_id, { outcome: 'skipped', skip_reason: 'no_time' })
    }
    const small = await rec(s)
    await answer(s, small.json.recommendation_id, { outcome: 'completed', enjoyment: 4 })
    expect((await rec(s)).json.mode).toBe('normal')
  })

  it('gives a stretch only to someone with high energy and two enjoyed completions', async () => {
    const s = await onboarded()
    for (let i = 0; i < 2; i++) {
      const r = await rec(s)
      await answer(s, r.json.recommendation_id, { outcome: 'completed', enjoyment: 5 })
    }
    expect((await rec(s, { mood: 'ok' })).json.mode).toBe('normal')
    const big = await rec(s, { mood: 'high' })
    expect(big.json.mode).toBe('excellent')
    expect(big.json.reason).toContain('went well')
  })

  it('does not count recommendations nobody answered as failures', async () => {
    const s = await onboarded()
    for (let i = 0; i < 4; i++) await rec(s) // never answered
    expect((await rec(s)).json.mode).toBe('normal')
  })

  it('the person\'s own choice always wins, even right after skips', async () => {
    const s = await onboarded()
    for (let i = 0; i < 2; i++) {
      const r = await rec(s)
      await answer(s, r.json.recommendation_id, { outcome: 'skipped' })
    }
    const chosen = await rec(s, { mode: 'excellent' })
    expect(chosen.json.mode).toBe('excellent')
    expect(chosen.json.reason).toContain('You asked for a bigger one.')
    const normal = await rec(s, { mode: 'normal' })
    expect(normal.json.mode).toBe('normal')
    expect(normal.json.reason).not.toContain('small on purpose')
  })

  it('rejects an unknown mode', async () => {
    const r = await (await onboarded()).call<ApiErrorBody>('POST', '/api/recommend', { duration_limit: 30, mode: 'insane' })
    expect(r.status).toBe(400)
  })
})

describe('learning from feedback, end to end', () => {
  it('changes the next recommendation after a few answers, and the reason cites what happened', async () => {
    // Says they like running; owns a racket but never said they like badminton.
    const s = await onboarded({ ...PROFILE, preferences: { ...PROFILE.preferences, likes: ['running'] } })
    const first = await rec(s, { mode: 'normal' })
    expect(first.json.activity_id).toBe('easy_jog') // stated preference, no history yet

    // Then what they actually do: skip running four times, play and enjoy badminton four times.
    for (let i = 0; i < 4; i++) {
      const skipped = await rec(s, { mode: 'normal' })
      await answer(s, skipped.json.recommendation_id, { outcome: 'skipped', skip_reason: 'too_tired' })
    }
    for (let i = 0; i < 4; i++) {
      await s.repo.addEvent(await userKey(), {
        recommendation_id: `r_00000000-0000-4000-8000-00000000000${i}`,
        activity_id: 'badminton_game',
        timestamp: `2026-10-0${i + 1}T17:00:00+05:30`,
        outcome: 'completed',
        enjoyment: 5,
        context: { duration_limit: 60, mood: 'ok', social_available: true, hour: 17 },
      })
    }
    const later = await rec(s, { mode: 'normal' })
    expect(later.json.activity_id).toBe('badminton_game')
    expect(later.json.reason).toMatch(/finished this|rated this/)
  })

  it('the upgrade sees the same size of day, so the AI cannot change it', async () => {
    const calls: AiRequest[] = []
    const ai: AiProvider = {
      name: 'scripted',
      async complete(req): Promise<AiCompletion> {
        calls.push(req)
        const id = (JSON.parse(req.user.split('\n')[0]!) as { candidates: { id: string }[] }).candidates[0]!.id
        return { text: JSON.stringify({ activity_id: id, reason: 'You like walking, and this is an easy way to start.', first_step: getActivity(id)!.firstStep }), model: 'scripted' }
      },
    }
    const s = setup(ai)
    await s.call('POST', '/api/onboarding', PROFILE)
    const first = await rec(s, { mode: 'minimum' })
    const up = await s.call<UpgradeResponse>('POST', `/api/recommend/${first.json.recommendation_id}/upgrade`)
    expect(up.json.upgraded).toBe(true)
    expect(up.json.recommendation?.mode).toBe('minimum')
    expect(up.json.recommendation?.duration_min).toBe(getActivity(up.json.recommendation!.activity_id)!.duration.min)
    expect(JSON.parse(calls[0]!.user.split('\n')[0]!).now.size).toBe('minimum')
    expect(up.json.recommendation?.preparation).toEqual(first.json.preparation.length ? up.json.recommendation?.preparation : [])
  })
})

describe('goals in the profile', () => {
  it('are saved, returned, and optional', async () => {
    const s = await onboarded({ ...PROFILE, goals: ['feel_calmer', 'move_more'] })
    const got = await s.call<ProfileResponse>('GET', '/api/profile')
    expect(got.json.profile.goals).toEqual(['feel_calmer', 'move_more'])
    const without = await onboarded()
    expect((await without.call<ProfileResponse>('GET', '/api/profile')).json.profile.goals).toEqual([])
  })

  it('can be changed with a patch without touching anything else', async () => {
    const s = await onboarded({ ...PROFILE, goals: ['move_more'] })
    const patched = await s.call<ProfileResponse>('PATCH', '/api/profile', { goals: ['be_creative'] })
    expect(patched.json.profile.goals).toEqual(['be_creative'])
    expect(patched.json.profile.equipment).toEqual(['racket', 'ball'])
    const kept = await s.call<ProfileResponse>('PATCH', '/api/profile', { motivators: ['calm'] })
    expect(kept.json.profile.goals).toEqual(['be_creative'])
  })

  it('a patch that omits a field never resets it (regression: zod defaults used to turn "absent" into "empty")', async () => {
    const s = await onboarded({ ...PROFILE, goals: ['move_more'], best_windows: ['17:00-19:00'] })
    const patched = await s.call<ProfileResponse>('PATCH', '/api/profile', { motivators: ['calm'] })
    expect(patched.json.profile.goals).toEqual(['move_more'])
    expect(patched.json.profile.schedule_signals.best_windows).toEqual(['17:00-19:00'])
  })

  it('reject unknown goals, and a profile saved before goals existed still works', async () => {
    const s = setup()
    expect((await s.call('POST', '/api/onboarding', { ...PROFILE, goals: ['world_domination'] })).status).toBe(400)
    const old = { ...PROFILE } // no "goals" key at all, like every profile saved before this stage
    expect((await s.call('POST', '/api/onboarding', old)).status).toBe(200)
    expect((await rec(s)).status).toBe(200)
  })

  it('influence a recommendation', async () => {
    const calm = await onboarded({ ...PROFILE, preferences: { ...PROFILE.preferences, likes: [] }, motivators: [], goals: ['feel_calmer'] })
    const r = await rec(calm, { mode: 'normal', social_available: false })
    expect(getActivity(r.json.activity_id)!.motivators).toContain('calm')
  })
})
