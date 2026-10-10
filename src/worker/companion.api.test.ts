import { describe, expect, it } from 'vitest'
import type { ApiErrorBody, ExperimentResponse, FeedbackResponse, LearnedResponse, MemoriesResponse, MemoryResponse, MetricsResponse, MissionsResponse, ProfileResponse, RecommendResponse } from '@/shared/api'
import { getActivity } from '@/shared/engine'
import type { MeadowSummary } from '@/shared/meadow'
import { createApp } from './app'
import { MemoryRepository, type StoredEvent } from './repository'

// Synthetic users, in memory. Time moves one minute per call from a fixed start (2026-10-07 12:00 UTC = 17:30 in +05:30).

const A = '7a3b8c1e-5d4a-4b7e-9c6d-1a2b3c4d5e6f'
const B = '8a3b8c1e-5d4a-4b7e-9c6d-1a2b3c4d5e6f'
const ADMIN = 'a'.repeat(40)
const PROFILE = {
  preferences: { likes: ['walking'], dislikes: [], preferred_duration_min: 45, social_preference: 'any' },
  motivators: ['calm'],
  avoidances: [],
  equipment: ['racket', 'ball'],
  best_windows: [],
}

async function userKeyOf(session: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(session))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function setup(env: Record<string, string> = {}) {
  let t = new Date('2026-10-07T12:00:00Z').getTime()
  const repo = new MemoryRepository()
  const app = createApp({
    repo,
    now: () => {
      t += 60_000
      return new Date(t)
    },
  })
  const call = async <T>(method: string, path: string, body?: unknown, session: string | null = A, headers: Record<string, string> = {}) => {
    const h: Record<string, string> = { 'content-type': 'application/json', ...headers }
    if (session) h['x-session-id'] = session
    const res = await app.request(path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }, env)
    return { status: res.status, json: (await res.json()) as T }
  }
  return { call, repo }
}
type S = ReturnType<typeof setup>

async function onboarded(profile: Record<string, unknown> = PROFILE, env: Record<string, string> = {}) {
  const s = setup(env)
  expect((await s.call('POST', '/api/onboarding', profile)).status).toBe(200)
  return s
}
const rec = (s: S, over: Record<string, unknown> = {}, session = A) =>
  s.call<RecommendResponse>('POST', '/api/recommend', { duration_limit: 60, mode: 'normal', use_ai: false, utc_offset_minutes: 330, ...over }, session)
const answer = (s: S, id: string, body: Record<string, unknown>, session = A) => s.call<FeedbackResponse & ApiErrorBody>('POST', '/api/feedback', { recommendation_id: id, ...body }, session)
const done = async (s: S, body: Record<string, unknown> = {}, recOver: Record<string, unknown> = {}) => {
  const r = (await rec(s, recOver)).json
  const f = await answer(s, r.recommendation_id, { outcome: 'completed', ...body })
  expect(f.status, JSON.stringify(f.json)).toBe(200)
  return { r, f }
}

/** Seeds answered history directly (so a test can set up a pattern without going through the whole loop). */
async function seed(s: S, items: Partial<StoredEvent>[], session = A) {
  const key = await userKeyOf(session)
  for (const [i, it] of items.entries()) {
    await s.repo.addEvent(key, {
      recommendation_id: `r_${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`,
      activity_id: 'brisk_walk_loop',
      timestamp: `2026-09-${String(1 + (i % 27)).padStart(2, '0')}T19:00:00+05:30`,
      outcome: 'completed',
      responded_at: `2026-09-${String(1 + (i % 27)).padStart(2, '0')}T14:00:00.000Z`,
      context: { duration_limit: 30, mood: 'ok', social_available: false, hour: 19, planned_min: 30 },
      ...it,
    })
  }
}

describe('the companion on every recommendation', () => {
  it('comes with a note, small steps that add up, a two-minute start, and tells the flow', async () => {
    const r = (await rec(await onboarded(), { duration_limit: 15, mood: 'low', desired_outcome: 'clear_head' })).json
    expect(r.companion.note).toContain('You have 15 minutes and your energy is low.')
    expect(r.companion.note).toContain('clear your head')
    expect(r.companion.steps.reduce((s, x) => s + x.minutes, 0)).toBe(r.duration_min)
    expect(r.companion.tiny_start).toMatchObject({ minutes: 2 })
    expect(r.flow).toBe('companion')
  })

  it('the desired outcome changes what is chosen, and is saved with the mission', async () => {
    const s = await onboarded({ ...PROFILE, preferences: { ...PROFILE.preferences, likes: [] }, motivators: [] })
    const calm = (await rec(s, { desired_outcome: 'clear_head', duration_limit: 120, social_available: false })).json
    expect(getActivity(calm.activity_id)!.intensity).toBe(1)
    const events = await s.repo.listEvents(await userKeyOf(A), 5)
    expect(events[0]!.context.desired_outcome).toBe('clear_head')
    expect(events[0]!.context.social_mode).toBeTruthy()
    expect(events[0]!.context.created_at).toMatch(/^2026-10-07T/)
  })

  it('rejects an unknown desired outcome', async () => {
    expect((await rec(await onboarded(), { desired_outcome: 'win' })).status).toBe(400)
  })

  it('offers the window-or-balcony version when energy is low and the activity needs the outdoors', async () => {
    const r = (await rec(await onboarded(), { mood: 'low', duration_limit: 40 })).json
    if (getActivity(r.activity_id)!.weather !== 'any') expect(r.companion.alternative).toMatch(/window|balcony|call|message|home/i)
  })
})

describe('the experiment switch', () => {
  it('gives everyone the Mission Companion by default', async () => {
    const s = await onboarded()
    expect((await s.call<ProfileResponse>('GET', '/api/profile')).json.flow).toBe('companion')
    expect((await rec(s)).json.flow).toBe('companion')
  })

  it('puts a share in the plain arm when switched on, decided per person (the same person always gets the same arm)', async () => {
    const all = await onboarded(PROFILE, { EXPERIMENT_PCT: '100' })
    expect((await all.call<ProfileResponse>('GET', '/api/profile')).json.flow).toBe('classic')
    const none = await onboarded(PROFILE, { EXPERIMENT_PCT: '0' })
    expect((await none.call<ProfileResponse>('GET', '/api/profile')).json.flow).toBe('companion')
    const half = await onboarded(PROFILE, { EXPERIMENT_PCT: '50' })
    const first = (await half.call<ProfileResponse>('GET', '/api/profile')).json.flow
    for (let i = 0; i < 3; i++) expect((await half.call<ProfileResponse>('GET', '/api/profile')).json.flow).toBe(first)
  })

  it('splits roughly as asked across many different people', async () => {
    let classic = 0
    const s = setup({ EXPERIMENT_PCT: '30' })
    for (let i = 0; i < 200; i++) {
      const session = `${String(i).padStart(8, '0')}-5d4a-4b7e-9c6d-1a2b3c4d5e6f`
      await s.call('POST', '/api/onboarding', PROFILE, session)
      if ((await s.call<ProfileResponse>('GET', '/api/profile', undefined, session)).json.flow === 'classic') classic++
    }
    expect(classic).toBeGreaterThan(30)
    expect(classic).toBeLessThan(90)
  })

  it('ignores nonsense settings', async () => {
    for (const v of ['abc', '-5', '500', '']) {
      const s = await onboarded(PROFILE, { EXPERIMENT_PCT: v })
      expect(['companion', 'classic']).toContain((await s.call<ProfileResponse>('GET', '/api/profile')).json.flow)
    }
    expect((await (await onboarded(PROFILE, { EXPERIMENT_PCT: 'abc' })).call<ProfileResponse>('GET', '/api/profile')).json.flow).toBe('companion')
  })
})

describe('the reflection after a mission', () => {
  it('stores what they said, and shows it back as a memory and as the mission record', async () => {
    const s = await onboarded()
    const { r } = await done(s, {
      enjoyment: 4,
      minutes_outside: 14,
      minutes_source: 'measured',
      started_at: '2026-10-07T12:00:00.000Z',
      feeling: 'calmer',
      helper: 'noticing_things',
      barrier: 'too_tired',
      would_repeat: 'yes',
      note: 'Sitting felt easier than walking today, and the birds helped.',
      has_photo: true,
    }, { duration_limit: 15, desired_outcome: 'clear_head', mood: 'low' })

    const mem = (await s.call<MemoriesResponse>('GET', '/api/memories')).json.items[0]!
    expect(mem).toMatchObject({ mission_id: r.recommendation_id, feeling: 'calmer', helper: 'noticing_things', barrier: 'too_tired', would_repeat: 'yes', has_photo: true, participation: 'full', note: 'Sitting felt easier than walking today, and the birds helped.' })
    expect(mem.evidence).toEqual(expect.arrayContaining(['photo', 'reflection']))
    expect(mem.support).toBe('reflected')

    const rec0 = (await s.call<MissionsResponse>('GET', '/api/missions')).json.records[0]!
    expect(rec0).toMatchObject({
      mission_id: r.recommendation_id,
      activity_type: r.activity_id,
      user_selected_duration: 15,
      participation_status: 'full',
      pre_activity_energy: 'low',
      desired_outcome: 'clear_head',
      post_activity_feeling: 'calmer',
      difficulty_or_barrier: 'too_tired',
      would_repeat: 'yes',
      optional_reflection: 'Sitting felt easier than walking today, and the birds helped.',
      mission_started_at: '2026-10-07T12:00:00.000Z',
    })
    expect(rec0.recommended_duration).toBe(r.duration_min)
    expect(rec0.mission_returned_at).toMatch(/^2026-10-07T/)
    expect(rec0.created_at).toMatch(/^2026-10-07T12:0/)
  })

  it('says plainly what will be done differently because of the answers', async () => {
    const s = await onboarded()
    const { f } = await done(s, { feeling: 'calmer', helper: 'noticing_things', would_repeat: 'no' })
    expect(f.json.adaptations.join(' ')).toMatch(/calmer.*gentle resets/)
    expect(f.json.adaptations.join(' ')).toMatch(/discovery-based/)
    expect(f.json.adaptations.join(' ')).toMatch(/suggest this one less/)
    const none = await done(s)
    expect(none.f.json.adaptations).toEqual([])
  })

  it('offers to stop suggesting something they would not repeat, and only once it is not already avoided', async () => {
    const s = await onboarded()
    const first = await done(s, { would_repeat: 'no' })
    expect(first.f.json.ask_to_avoid).toMatchObject({ activity_id: first.r.activity_id })
    await s.call('PATCH', '/api/profile', { avoid_activities: [first.r.activity_id] })
    const again = await done(s, { would_repeat: 'no' })
    expect(again.f.json.ask_to_avoid?.activity_id).not.toBe(first.r.activity_id)
  })

  it('rejects reflection fields for missions that did not happen, and bad values', async () => {
    const s = await onboarded()
    for (const extra of [{ feeling: 'calmer' }, { note: 'hi' }, { helper: 'company' }, { would_repeat: 'yes' }, { has_photo: true }, { started_at: '2026-10-07T12:00:00.000Z' }]) {
      const r = (await rec(s)).json
      expect((await answer(s, r.recommendation_id, { outcome: 'skipped', ...extra })).status, JSON.stringify(extra)).toBe(400)
    }
    const r = (await rec(s)).json
    for (const bad of [{ feeling: 'ecstatic' }, { helper: 'magic' }, { barrier: 'laziness' }, { would_repeat: 'definitely' }, { note: 'x'.repeat(281) }, { note: 'bad \u0007 char' }, { has_photo: 'yes' }, { minutes_source: 'guess' }, { started_at: 'yesterday' }]) {
      expect((await answer(s, r.recommendation_id, { outcome: 'completed', ...bad })).status, JSON.stringify(bad)).toBe(400)
    }
  })

  it('ignores an implausible start time instead of storing it (never accuses, never breaks)', async () => {
    const s = await onboarded()
    for (const started_at of ['2020-01-01T00:00:00.000Z', '2030-01-01T00:00:00.000Z']) {
      const { r } = await done(s, { started_at, minutes_outside: 10 })
      const stored = await s.repo.getEvent(await userKeyOf(A), r.recommendation_id)
      expect(stored).not.toHaveProperty('started_at')
      expect(stored!.outcome).toBe('completed') // the answer itself is untouched
    }
  })

  it('treats an empty note as no note, and trims a real one', async () => {
    const s = await onboarded()
    const blank = await done(s, { note: '   ' })
    expect((await s.repo.getEvent(await userKeyOf(A), blank.r.recommendation_id))!.reflection).toBeUndefined()
    const padded = await done(s, { note: '  hello  ' })
    expect((await s.repo.getEvent(await userKeyOf(A), padded.r.recommendation_id))!.reflection?.note).toBe('hello')
  })

  it('evidence supports but never changes what they said: far less time than planned is still "full"', async () => {
    const s = await onboarded()
    const { r } = await done(s, { minutes_outside: 1, minutes_source: 'measured' })
    const item = (await s.call<MemoriesResponse>('GET', '/api/memories')).json.items[0]!
    expect(item.participation).toBe('full')
    expect(item.evidence).not.toContain('elapsed_time') // too short to count as supporting...
    expect(item.minutes).toBeGreaterThan(0) // ...yet it is still recorded and credited, never rejected
    expect(r.recommendation_id).toBe(item.mission_id)
  })
})

describe('when a mission did not happen', () => {
  it('always offers a smaller next step, never blame, and the right one for the reason', async () => {
    const s = await onboarded()
    const expectations: [string, RegExp, number][] = [
      ['couldnt_start', /two-minute/i, 5],
      ['too_tired', /restful|gentle/i, 15],
      ['no_time', /five minutes/i, 5],
    ]
    for (const [reason, label, minutes] of expectations) {
      const r = (await rec(s)).json
      const f = await answer(s, r.recommendation_id, { outcome: 'skipped', skip_reason: reason })
      expect(f.status).toBe(200)
      expect(f.json.next_step!.action!.label).toMatch(label)
      expect(f.json.next_step!.action!.plan.duration_limit).toBe(minutes)
      expect(JSON.stringify(f.json.next_step)).not.toMatch(/fail|lazy|should|disappoint/i)
    }
  })

  it('has a next step even with no reason given, and for "did something else"', async () => {
    const s = await onboarded()
    const a = await answer(s, (await rec(s)).json.recommendation_id, { outcome: 'skipped' })
    expect(a.json.next_step!.action).toBeTruthy()
    const b = await answer(s, (await rec(s)).json.recommendation_id, { outcome: 'changed' })
    expect(b.json.next_step!.headline).toMatch(/instead/)
  })

  it('recognises honesty with a seed and, on the third, a milestone. It adds no time and takes nothing away', async () => {
    const s = await onboarded()
    await done(s, { minutes_outside: 20 })
    const before = (await s.call<MeadowSummary>('GET', '/api/meadow')).json
    let last!: FeedbackResponse
    for (let i = 0; i < 3; i++) last = (await answer(s, (await rec(s)).json.recommendation_id, { outcome: i % 2 ? 'changed' : 'skipped', ...(i % 2 ? {} : { skip_reason: 'couldnt_start' }) })).json
    expect(last.recognition!.seeds).toBe(3)
    expect(last.recognition!.new_milestones.map((m) => m.id)).toContain('honest_checkins')
    expect(last.reward).toBeUndefined()
    const after = (await s.call<MeadowSummary>('GET', '/api/meadow')).json
    expect(after.garden.seeds).toBe(3)
    expect(after.total_minutes).toBe(before.total_minutes) // no time added
    expect(after.missions).toBe(before.missions)
  })

  it('"I could not get started" makes the next recommendation a tiny start, and says why', async () => {
    const s = await onboarded()
    await answer(s, (await rec(s)).json.recommendation_id, { outcome: 'skipped', skip_reason: 'couldnt_start' })
    const next = (await rec(s, { mode: 'auto' })).json
    expect(next.mode).toBe('minimum')
    expect(next.reason).toContain('starting was the hard part')
  })
})

describe('never suggest this again', () => {
  it('is kept, validated, never suggested, and survives saving preferences again', async () => {
    const s = await onboarded()
    expect((await s.call('PATCH', '/api/profile', { avoid_activities: ['nope_not_real'] })).status).toBe(400)
    const patched = await s.call<ProfileResponse>('PATCH', '/api/profile', { avoid_activities: ['brisk_walk_loop', 'brisk_walk_loop', 'easy_jog'] })
    expect(patched.json.profile.avoid_activities).toEqual(['brisk_walk_loop', 'easy_jog'])
    for (let i = 0; i < 4; i++) expect(['brisk_walk_loop', 'easy_jog']).not.toContain((await rec(s)).json.activity_id)

    // saving preferences again (the Preferences page sends no avoid list) must not wipe it
    await s.call('POST', '/api/onboarding', PROFILE)
    expect((await s.call<ProfileResponse>('GET', '/api/profile')).json.profile.avoid_activities).toEqual(['brisk_walk_loop', 'easy_jog'])
    // and it can be cleared on purpose
    const cleared = await s.call<ProfileResponse>('PATCH', '/api/profile', { avoid_activities: [] })
    expect(cleared.json.profile.avoid_activities).toBeUndefined()
  })
})

describe('what the assistant has learned, and the person\'s say over it', () => {
  const hardEvenings = () => [
    ...Array.from({ length: 5 }, (_, i) => ({ outcome: 'skipped' as const, skip_reason: 'couldnt_start' as const, timestamp: `2026-09-0${i + 1}T19:00:00+05:30` })),
    ...Array.from({ length: 4 }, (_, i) => ({ timestamp: `2026-09-1${i}T08:00:00+05:30` })),
  ]

  it('is empty at first, with the explanation', async () => {
    const l = (await (await onboarded()).call<LearnedResponse>('GET', '/api/learned')).json
    expect(l.items).toEqual([])
    expect(l.explanation).toMatch(/guesses/)
    expect(l.suggestion).toBeNull()
  })

  it('shows tentative patterns with the real numbers behind them', async () => {
    const s = await onboarded()
    await seed(s, hardEvenings())
    const l = (await s.call<LearnedResponse>('GET', '/api/learned?utc_offset_minutes=330')).json
    const hard = l.items.find((i) => i.id === 'hard_time:part:evenings')!
    expect(hard).toMatchObject({ text: 'Evenings have been harder to start.', status: 'active', strength: 'tentative' })
    expect(hard.evidence).toBe('You started 0 of 5 missions planned in the evenings.')
    expect(l.items.find((i) => i.id === 'easy_time:part:mornings')).toBeTruthy()
  })

  it('lets them confirm one (it becomes a lesson in the garden), dismiss one, and restore it', async () => {
    const s = await onboarded()
    await seed(s, hardEvenings())
    const confirm = await s.call<LearnedResponse>('POST', '/api/learned/respond', { id: 'hard_time:part:evenings', action: 'confirm' })
    expect(confirm.json.items.find((i) => i.id === 'hard_time:part:evenings')!.status).toBe('confirmed')
    expect(confirm.json.lessons).toHaveLength(1)
    expect(confirm.json.lessons[0]).toMatchObject({ id: 'hard_time:part:evenings', text: 'Evenings have been harder to start.' })
    expect((await s.call<MeadowSummary>('GET', '/api/meadow')).json.garden.lessons).toBe(1)

    const dismiss = await s.call<LearnedResponse>('POST', '/api/learned/respond', { id: 'hard_time:part:evenings', action: 'dismiss' })
    expect(dismiss.json.items.find((i) => i.id === 'hard_time:part:evenings')!.status).toBe('dismissed')
    expect(dismiss.json.lessons).toEqual([]) // dismissing a lesson removes it
    expect(dismiss.json.suggestion?.text ?? '').not.toMatch(/Evenings have been harder/) // a dismissed pattern is never used for suggestions (another true one may be)

    const restore = await s.call<LearnedResponse>('POST', '/api/learned/respond', { id: 'hard_time:part:evenings', action: 'restore' })
    expect(restore.json.items.find((i) => i.id === 'hard_time:part:evenings')!.status).toBe('active')
  })

  it('refuses to confirm or dismiss something it has not noticed', async () => {
    const s = await onboarded()
    await seed(s, hardEvenings())
    expect((await s.call('POST', '/api/learned/respond', { id: 'enjoys_kind:exploration', action: 'confirm' })).status).toBe(404)
    expect((await s.call('POST', '/api/learned/respond', { id: 'made_up', action: 'dismiss' })).status).toBe(404)
    expect((await s.call('POST', '/api/learned/respond', { id: 'x', action: 'explode' })).status).toBe(400)
    expect((await s.call('POST', '/api/learned/respond', { id: 'hard_time:part:evenings' })).status).toBe(400)
  })

  it('"start again" ignores earlier answers for learning but leaves missions, the meadow and memories exactly as they were', async () => {
    const s = await onboarded()
    await done(s, { minutes_outside: 20, note: 'A walk worth keeping.' })
    await seed(s, hardEvenings())
    await s.call('POST', '/api/learned/respond', { id: 'hard_time:part:evenings', action: 'confirm' })
    const meadowBefore = (await s.call<MeadowSummary>('GET', '/api/meadow')).json
    expect((await s.call<LearnedResponse>('GET', '/api/learned')).json.items.length).toBeGreaterThan(0)

    const reset = await s.call<LearnedResponse>('DELETE', '/api/learned')
    expect(reset.json.items).toEqual([])
    expect(reset.json.lessons).toEqual([])
    expect(reset.json.reset_at).toMatch(/^2026-10-07T/)

    const meadowAfter = (await s.call<MeadowSummary>('GET', '/api/meadow')).json
    expect(meadowAfter.total_minutes).toBe(meadowBefore.total_minutes)
    expect(meadowAfter.missions).toBe(meadowBefore.missions)
    expect(meadowAfter.garden.keepsakes).toBe(meadowBefore.garden.keepsakes)
    expect(meadowAfter.garden.lessons).toBe(0) // the lesson was theirs to remove
    expect((await s.call<MemoriesResponse>('GET', '/api/memories')).json.items.some((m) => m.note === 'A walk worth keeping.')).toBe(true)
  })

  it('learns again from what they answer after a reset', async () => {
    const s = await onboarded()
    await seed(s, hardEvenings())
    await s.call('DELETE', '/api/learned')
    expect((await s.call<LearnedResponse>('GET', '/api/learned')).json.items).toEqual([])
    const key = await userKeyOf(A)
    for (let i = 0; i < 2; i++) {
      await s.repo.addEvent(key, {
        recommendation_id: `r_ffffffff-000${i}-4000-8000-000000000000`,
        activity_id: 'easy_jog',
        timestamp: `2026-10-0${i + 8}T10:00:00+05:30`,
        outcome: 'skipped',
        skip_reason: 'too_far',
        responded_at: `2026-10-0${i + 8}T12:00:00.000Z`,
        context: { duration_limit: 30, mood: 'ok', social_available: false, hour: 10 },
      })
    }
    expect((await s.call<LearnedResponse>('GET', '/api/learned')).json.items.map((i) => i.id)).toEqual(['barrier:too_far'])
  })

  it('suggests something small right now when a pattern matches this moment', async () => {
    const s = await onboarded()
    await seed(s, hardEvenings())
    // 17:30 local in this test clock = evenings
    const l = (await s.call<LearnedResponse>('GET', '/api/learned?utc_offset_minutes=330')).json
    expect(l.suggestion?.text).toMatch(/Evenings have been harder to start\./)
    expect(l.suggestion?.text).toMatch(/Want to try something short right now\?/)
    expect(l.suggestion?.plan).toMatchObject({ duration_limit: 15, mode: 'minimum' })
  })

  it('shows the things they asked never to see again, by name', async () => {
    const s = await onboarded()
    await s.call('PATCH', '/api/profile', { avoid_activities: ['brisk_walk_loop'] })
    expect((await s.call<LearnedResponse>('GET', '/api/learned')).json.avoid).toEqual([{ activity_id: 'brisk_walk_loop', title: 'Brisk walk, one familiar loop' }])
  })

  it('needs a profile to change anything, and keeps each person\'s own', async () => {
    const s = setup()
    expect((await s.call('POST', '/api/learned/respond', { id: 'a:b', action: 'dismiss' })).status).toBe(404)
    expect((await s.call('DELETE', '/api/learned')).status).toBe(404)
    expect((await s.call<LearnedResponse>('GET', '/api/learned')).json.items).toEqual([])
    const t = await onboarded()
    await seed(t, hardEvenings())
    await t.call('POST', '/api/onboarding', PROFILE, B)
    expect((await t.call<LearnedResponse>('GET', '/api/learned', undefined, B)).json.items).toEqual([])
  })

  it('what is learned reaches the recommendation, in plain words, and dismissing it makes it stop', async () => {
    const s = await onboarded({ ...PROFILE, preferences: { ...PROFILE.preferences, likes: [] }, motivators: [], equipment: [] })
    const day = (i: number) => String(1 + i).padStart(2, '0')
    await seed(s, [
      ...Array.from({ length: 3 }, (_, i) => ({ activity_id: 'new_street_walk', enjoyment: 5, timestamp: `2026-09-${day(i)}T10:00:00+05:30`, responded_at: `2026-09-${day(i)}T05:00:00.000Z` })),
      ...Array.from({ length: 3 }, (_, i) => ({ activity_id: 'brisk_walk_loop', enjoyment: 3, timestamp: `2026-09-${day(i + 5)}T10:00:00+05:30`, responded_at: `2026-09-${day(i + 5)}T05:00:00.000Z` })),
    ])
    const learned = (await s.call<LearnedResponse>('GET', '/api/learned')).json
    const active = learned.items.filter((i) => i.status === 'active')
    expect(active.map((i) => i.id)).toEqual(expect.arrayContaining(['enjoys_kind:exploration', 'appeal:novelty']))

    const before = (await rec(s, { duration_limit: 120, social_available: false })).json
    expect(active.some((i) => before.reason.includes(i.text)), `reason was: ${before.reason}`).toBe(true)

    for (const i of active) await s.call('POST', '/api/learned/respond', { id: i.id, action: 'dismiss' })
    const after = (await rec(s, { duration_limit: 120, social_available: false })).json
    expect(active.some((i) => after.reason.includes(i.text)), `reason was: ${after.reason}`).toBe(false)
  })
})

describe('memories: view, correct, remove', () => {
  it('lists only missions that happened, newest first', async () => {
    const s = await onboarded()
    await done(s, { note: 'first' })
    await answer(s, (await rec(s)).json.recommendation_id, { outcome: 'skipped' })
    await done(s, { note: 'second' })
    const items = (await s.call<MemoriesResponse>('GET', '/api/memories')).json.items
    expect(items.map((i) => i.note)).toEqual(['second', 'first'])
    expect((await s.call('GET', '/api/memories?limit=0')).status).toBe(400)
    expect((await s.call<MemoriesResponse>('GET', '/api/memories?limit=1')).json.items).toHaveLength(1)
  })

  it('lets them rewrite or remove a note, correct a feeling, and drop the photo flag', async () => {
    const s = await onboarded()
    const { r } = await done(s, { note: 'old words', feeling: 'same', would_repeat: 'maybe', has_photo: true })
    const edit = await s.call<MemoryResponse>('PATCH', `/api/memories/${r.recommendation_id}`, { note: '  new words  ', feeling: 'calmer', would_repeat: 'yes', has_photo: false })
    expect(edit.json.item).toMatchObject({ note: 'new words', feeling: 'calmer', would_repeat: 'yes', has_photo: false })
    const wipe = await s.call<MemoryResponse>('PATCH', `/api/memories/${r.recommendation_id}`, { note: null, feeling: null, would_repeat: null })
    expect(wipe.json.item).toMatchObject({ note: null, feeling: null, would_repeat: null })
    expect((await s.repo.getEvent(await userKeyOf(A), r.recommendation_id))!.reflection).toBeUndefined()
  })

  it('changes the meadow to match (a removed note no longer counts as a keepsake)', async () => {
    const s = await onboarded()
    const { r } = await done(s, { note: 'keep me' })
    expect((await s.call<MeadowSummary>('GET', '/api/meadow')).json.garden.keepsakes).toBe(1)
    await s.call('PATCH', `/api/memories/${r.recommendation_id}`, { note: null })
    expect((await s.call<MeadowSummary>('GET', '/api/meadow')).json.garden.keepsakes).toBe(0)
  })

  it('refuses nonsense, missions that did not happen, other people\'s memories and unknown ids', async () => {
    const s = await onboarded()
    const { r } = await done(s, { note: 'mine' })
    const skipped = (await rec(s)).json
    await answer(s, skipped.recommendation_id, { outcome: 'skipped' })
    expect((await s.call('PATCH', `/api/memories/${skipped.recommendation_id}`, { note: 'x' })).status).toBe(404)
    expect((await s.call('PATCH', `/api/memories/${r.recommendation_id}`, {})).status).toBe(400)
    expect((await s.call('PATCH', `/api/memories/${r.recommendation_id}`, { note: 'x'.repeat(281) })).status).toBe(400)
    expect((await s.call('PATCH', `/api/memories/${r.recommendation_id}`, { feeling: 'wild' })).status).toBe(400)
    expect((await s.call('PATCH', `/api/memories/${r.recommendation_id}`, { surprise: 1 })).status).toBe(400)
    expect((await s.call('PATCH', '/api/memories/not-an-id', { note: 'x' })).status).toBe(400)
    await s.call('POST', '/api/onboarding', PROFILE, B)
    expect((await s.call('PATCH', `/api/memories/${r.recommendation_id}`, { note: 'stolen' }, B)).status).toBe(404)
    expect((await s.call<MemoriesResponse>('GET', '/api/memories', undefined, B)).json.items).toEqual([])
    expect((await s.call<MemoriesResponse>('GET', '/api/memories')).json.items[0]!.note).toBe('mine')
  })
})

describe('real-world value metrics', () => {
  it('describes only what the answers support, with no app-time anywhere', async () => {
    const s = await onboarded()
    await done(s, { enjoyment: 5, feeling: 'calmer' })
    await done(s, { enjoyment: 4, feeling: 'happier' })
    await answer(s, (await rec(s)).json.recommendation_id, { outcome: 'skipped' })
    await done(s, { enjoyment: 4, feeling: 'same' })
    const m = (await s.call<MetricsResponse>('GET', '/api/metrics')).json
    expect(m.metrics).toMatchObject({ recommendations: 4, answered: 4, participation: { full: 3, partial: 0, not_started: 1, something_else: 0 } })
    expect(m.metrics.start_rate).toBe(0.75)
    expect(m.metrics.recovery).toEqual({ missed: 1, resumed: 1 })
    expect(m.lines.join(' ')).toMatch(/real attempt/)
    expect(JSON.stringify(m)).not.toMatch(/streak|time_in_app|session_minutes/i)
  })

  it('is calm and empty for a new person', async () => {
    const m = (await (await onboarded()).call<MetricsResponse>('GET', '/api/metrics')).json
    expect(m.metrics.start_rate).toBeNull()
    expect(m.lines).toEqual([])
  })
})

describe('the garden', () => {
  it('holds a keepsake, a social token and a tree, from real answers', async () => {
    const s = await onboarded({ ...PROFILE, equipment: [] })
    // three enjoyed missions of the same activity make a tree
    const key = await userKeyOf(A)
    for (let i = 0; i < 3; i++) {
      await s.repo.addEvent(key, {
        recommendation_id: `r_dddddddd-000${i}-4000-8000-000000000000`,
        activity_id: 'walk_and_talk',
        timestamp: `2026-09-0${i + 1}T10:00:00+05:30`,
        outcome: 'completed',
        enjoyment: 5,
        responded_at: `2026-09-0${i + 1}T12:00:00.000Z`,
        reflection: i === 0 ? { note: 'A good talk.' } : undefined,
        context: { duration_limit: 45, mood: 'ok', social_available: true, hour: 10, planned_min: 45, social_mode: 'with_friend' },
      })
    }
    const g = (await s.call<MeadowSummary>('GET', '/api/meadow')).json.garden
    expect(g.trees.map((t) => t.activity_id)).toEqual(['walk_and_talk'])
    expect(g.keepsakes).toBe(1)
    expect(g.social_tokens).toBe(3)
  })
})

describe('the experiment report', () => {
  it('is switched off (and invisible) unless an admin token is set', async () => {
    const s = await onboarded()
    expect((await s.call('GET', '/api/admin/experiment', undefined, null)).status).toBe(404)
    expect((await s.call('GET', '/api/admin/experiment', undefined, null, { authorization: `Bearer ${ADMIN}` })).status).toBe(404)
  })

  it('needs the exact token, and needs no session', async () => {
    const s = await onboarded(PROFILE, { ADMIN_TOKEN: ADMIN })
    for (const header of [undefined, 'Bearer ', 'Bearer wrong', `Bearer ${ADMIN}x`, ADMIN, `Basic ${ADMIN}`]) {
      const r = await s.call<ApiErrorBody>('GET', '/api/admin/experiment', undefined, null, header ? { authorization: header } : {})
      expect(r.status, String(header)).toBe(401)
    }
    expect((await s.call('GET', '/api/admin/experiment', undefined, null, { authorization: `Bearer ${ADMIN}` })).status).toBe(200)
  })

  it('reports anonymous totals per arm, and nothing that identifies anyone', async () => {
    const env = { ADMIN_TOKEN: ADMIN, EXPERIMENT_PCT: '0' }
    const s = await onboarded(PROFILE, env)
    await done(s, { enjoyment: 4, would_repeat: 'yes' })
    await answer(s, (await rec(s)).json.recommendation_id, { outcome: 'skipped' })
    const r = await s.call<ExperimentResponse>('GET', '/api/admin/experiment', undefined, null, { authorization: `Bearer ${ADMIN}` })
    expect(r.json.classic_percent).toBe(0)
    expect(r.json.arms).toEqual([{ flow: 'companion', recommendations: 2, started: 1, full: 1, partial: 0, declined: 1, unanswered: 0, average_enjoyment: 4, would_repeat_yes: 1, with_reflection: 1 }])
    expect(JSON.stringify(r.json)).not.toMatch(new RegExp(`${A}|${B}|r_[0-9a-f]{8}`))
  })
})
