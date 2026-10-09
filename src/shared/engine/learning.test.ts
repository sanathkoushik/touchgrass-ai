import { describe, expect, it } from 'vitest'
import {
  ACTIVITIES,
  chooseMode,
  effectiveMood,
  evidenceFacts,
  getActivity,
  planDeterministic,
  planDuration,
  preparationFor,
  rank,
  type Context,
  type HistoryEvent,
  type UserProfile,
} from './index'

// Synthetic fixtures, used only to exercise the engine. Never shown in the app.

const ALL_GEAR = ['bicycle', 'racket', 'ball', 'swimwear', 'yoga_mat', 'sketchbook', 'cards', 'trash_bag'] as const

const profile = (over: Partial<UserProfile> = {}): UserProfile => ({
  user_id: 'test_user',
  preferences: { likes: [], dislikes: [], preferred_duration_min: 45, social_preference: 'any' },
  motivators: [],
  avoidances: [],
  equipment: [...ALL_GEAR],
  ...over,
})

const ctx = (over: Partial<Context> = {}): Context => ({
  duration_limit: 90,
  social_available: true,
  mood: 'ok',
  hour: 17,
  weather: { category: 'clear', temp_c: 24 },
  ...over,
})

let n = 0
const ev = (activity_id: string, outcome: HistoryEvent['outcome'], extra: Partial<HistoryEvent> = {}): HistoryEvent => {
  n += 1
  const day = String(1 + Math.floor(n / 3)).padStart(2, '0')
  return { activity_id, timestamp: `2026-09-${day}T17:0${n % 3}:00+05:30`, outcome, ...extra }
}
const times = (k: number, make: () => HistoryEvent) => Array.from({ length: k }, make)

describe('chooseMode: the size of the day adapts to what has happened', () => {
  it('goes small after two skips in a row ("immediate recovery"), whatever the mood', () => {
    const h = [ev('brisk_walk_loop', 'completed'), ev('easy_jog', 'skipped'), ev('cycling_ride', 'skipped')]
    for (const mood of ['low', 'ok', 'high'] as const) expect(chooseMode(h, mood)).toEqual({ mode: 'minimum', cause: 'recovery' })
  })

  it('does not punish a single skip, or a swap ("changed")', () => {
    expect(chooseMode([ev('a', 'completed'), ev('b', 'skipped')], 'ok')).toEqual({ mode: 'normal' })
    expect(chooseMode([ev('a', 'skipped'), ev('b', 'changed')], 'ok')).toEqual({ mode: 'normal' })
  })

  it('goes small for low energy', () => {
    expect(chooseMode([], 'low')).toEqual({ mode: 'minimum', cause: 'low_energy' })
  })

  it('stretches only with high energy AND two good recent ones (completed, enjoyed 4+)', () => {
    const good = [ev('a', 'completed', { enjoyment: 5 }), ev('b', 'completed', { enjoyment: 4 })]
    expect(chooseMode(good, 'high')).toEqual({ mode: 'excellent', cause: 'momentum' })
    expect(chooseMode(good, 'ok')).toEqual({ mode: 'normal' })
    expect(chooseMode([ev('a', 'completed', { enjoyment: 5 }), ev('b', 'completed', { enjoyment: 3 })], 'high')).toEqual({ mode: 'normal' })
    expect(chooseMode([ev('a', 'completed'), ev('b', 'completed', { enjoyment: 5 })], 'high')).toEqual({ mode: 'normal' })
  })

  it('judges by the newest events regardless of input order', () => {
    const old = { ...ev('a', 'completed'), timestamp: '2026-01-01T10:00:00+05:30' }
    const newer = [{ ...ev('b', 'skipped'), timestamp: '2026-09-02T10:00:00+05:30' }, { ...ev('c', 'skipped'), timestamp: '2026-09-03T10:00:00+05:30' }]
    expect(chooseMode([newer[1]!, old, newer[0]!], 'ok').cause).toBe('recovery')
  })

  it('an empty history is a normal day', () => {
    expect(chooseMode([], 'ok')).toEqual({ mode: 'normal' })
    expect(chooseMode([], 'high')).toEqual({ mode: 'normal' })
  })
})

describe('modes change what is planned', () => {
  it('effectiveMood: minimum plans as low energy, excellent as high (unless the person is low)', () => {
    expect(effectiveMood({ mood: 'high', mode: 'minimum' })).toBe('low')
    expect(effectiveMood({ mood: 'ok', mode: 'excellent' })).toBe('high')
    expect(effectiveMood({ mood: 'low', mode: 'excellent' })).toBe('ok')
    expect(effectiveMood({ mood: 'ok', mode: 'normal' })).toBe('ok')
    expect(effectiveMood({ mood: 'ok' })).toBe('ok')
  })

  it('minimum is the activity\'s shortest real version; excellent uses the time up to its max; normal is unchanged', () => {
    for (const a of ACTIVITIES) {
      const limit = 120
      const small = planDuration(a, ctx({ duration_limit: limit, mode: 'minimum' }))
      const normal = planDuration(a, ctx({ duration_limit: limit }))
      const big = planDuration(a, ctx({ duration_limit: limit, mode: 'excellent' }))
      expect(small, a.id).toBe(a.duration.min)
      expect(big, a.id).toBe(Math.min(a.duration.max, limit))
      expect(small, a.id).toBeLessThanOrEqual(normal)
      expect(normal, a.id).toBeLessThanOrEqual(big)
    }
  })

  it('excellent never plans past the time the person has', () => {
    for (const a of ACTIVITIES.filter((x) => x.duration.min <= 30)) {
      expect(planDuration(a, ctx({ duration_limit: 30, mode: 'excellent' })), a.id).toBeLessThanOrEqual(30)
    }
  })

  it('a small start never picks something intense or far away', () => {
    for (const mood of ['ok', 'high'] as const) {
      const r = rank(profile(), ctx({ mood, mode: 'minimum' }), [])
      for (const s of r.ranked) {
        if (r.usedGuaranteedFallback) break
        expect(s.activity.intensity, s.activity.id).toBeLessThan(3)
        expect(s.activity.travel, s.activity.id).not.toBe('far')
      }
    }
  })

  it('a stretch day still respects time, weather and dislikes', () => {
    const r = rank(profile({ preferences: { likes: [], dislikes: ['running'], preferred_duration_min: 45, social_preference: 'any' } }), ctx({ mode: 'excellent', duration_limit: 20, weather: { category: 'rain', temp_c: 20 } }), [])
    for (const s of r.ranked) {
      expect(s.activity.duration.min, s.activity.id).toBeLessThanOrEqual(20)
      expect(s.activity.weather, s.activity.id).toBe('any')
      expect(s.activity.tags, s.activity.id).not.toContain('running')
    }
  })

  it('the response carries the mode, defaulting to normal', () => {
    expect(planDeterministic(profile(), ctx()).recommendation.mode).toBe('normal')
    expect(planDeterministic(profile(), ctx({ mode: 'minimum', mode_cause: 'chosen' })).recommendation.mode).toBe('minimum')
  })

  it('a small start is actually shorter than a stretch for the same person and moment', () => {
    const small = planDeterministic(profile(), ctx({ mode: 'minimum' })).recommendation
    const big = planDeterministic(profile(), ctx({ mode: 'excellent' })).recommendation
    expect(small.duration_min).toBeLessThan(big.duration_min)
  })
})

describe('explanations tell the truth about the size of the day', () => {
  const reasonFor = (c: Context, h: HistoryEvent[] = []) => planDeterministic(profile(), c, h).recommendation.reason

  it('says why it is small after skips, without guilt', () => {
    const h = [ev('easy_jog', 'skipped'), ev('cycling_ride', 'skipped')]
    const { mode, cause } = chooseMode(h, 'ok')
    const reason = reasonFor(ctx({ mode, mode_cause: cause }), h)
    expect(reason).toContain('small on purpose')
    expect(reason).not.toMatch(/fail|lazy|should|streak/i)
  })

  it('credits the person\'s own request, and says nothing about size on a normal day', () => {
    expect(reasonFor(ctx({ mode: 'minimum', mode_cause: 'chosen' }))).toContain('You asked for a small start.')
    expect(reasonFor(ctx({ mode: 'excellent', mode_cause: 'chosen' }))).toContain('You asked for a bigger one.')
    expect(reasonFor(ctx())).not.toMatch(/small|bigger|stretch/i)
  })

  it('momentum is claimed only with the real streak of good outcomes behind it', () => {
    const good = [ev('a', 'completed', { enjoyment: 5 }), ev('b', 'completed', { enjoyment: 4 })]
    const m = chooseMode(good, 'high')
    expect(reasonFor(ctx({ mood: 'high', mode: m.mode, mode_cause: m.cause }), good)).toContain('went well')
  })
})

describe('learning: the next recommendation changes, for a reason that is true', () => {
  const walker = profile({ preferences: { likes: ['running', 'badminton'], dislikes: [], preferred_duration_min: 45, social_preference: 'any' } })

  it('after repeated skips of a liked activity and repeated completions of another, observed behaviour wins and says so', () => {
    const before = planDeterministic(walker, ctx(), []).recommendation
    const h = [
      ...times(4, () => ev('easy_jog', 'skipped', { skip_reason: 'too_tired' })),
      ...times(4, () => ev('badminton_game', 'completed', { enjoyment: 5 })),
    ]
    const after = planDeterministic(walker, ctx({ mood: 'ok' }), h).recommendation
    expect(after.activity_id).not.toBe('easy_jog')
    expect(after.activity_id === 'badminton_game' || before.activity_id !== after.activity_id).toBe(true)
    const ranked = rank(walker, ctx(), h).ranked.map((s) => s.activity.id)
    expect(ranked.indexOf('badminton_game')).toBeLessThan(ranked.indexOf('easy_jog'))
    if (after.activity_id === 'badminton_game') expect(after.reason).toMatch(/finished this 4 of 4|rated this 5/)
  })

  it('a skip for "too far" is answered by something that needs no travel, and the reason says so', () => {
    const h = [ev('nature_trail_hike', 'skipped', { skip_reason: 'too_far' })]
    const r = rank(profile(), ctx(), h)
    const top = r.ranked[0]!
    if (top.activity.travel === 'none') {
      expect(evidenceFacts(top, ctx())).toContain('You said the last one was too far; this needs no travel.')
    }
    // And whatever the top is, no activity claims to fix a skip it does not fix.
    for (const s of r.ranked) {
      if (s.evidence.addresses_skip === 'too_far') expect(s.activity.travel, s.activity.id).toBe('none')
    }
  })

  it('only the MOST RECENT skip reason is ever claimed as addressed', () => {
    const h = [ev('nature_trail_hike', 'skipped', { skip_reason: 'too_far' }), ev('easy_jog', 'skipped', { skip_reason: 'too_costly' })]
    for (const s of rank(profile(), ctx(), h).ranked) {
      expect(s.evidence.addresses_skip === null || s.evidence.addresses_skip === 'too_costly', s.activity.id).toBe(true)
    }
  })

  it('does not claim to fix a skip that is older than the last three events', () => {
    const h = [ev('nature_trail_hike', 'skipped', { skip_reason: 'too_far' }), ev('a', 'completed'), ev('b', 'completed'), ev('c', 'completed')]
    for (const s of rank(profile(), ctx(), h).ranked) expect(s.evidence.addresses_skip, s.activity.id).toBeNull()
  })

  it('the enjoyment claim needs real ratings of 4 or more', () => {
    const liked = [ev('brisk_walk_loop', 'completed', { enjoyment: 5 }), ev('brisk_walk_loop', 'completed', { enjoyment: 4 })]
    const walk = rank(profile(), ctx(), liked).ranked.find((s) => s.activity.id === 'brisk_walk_loop')!
    expect(walk.evidence.observed_enjoyment_avg).toBe(4.5)
    expect(evidenceFacts(walk, ctx())).toContain('You rated this 4.5 out of 5 before.')

    const meh = [ev('brisk_walk_loop', 'completed', { enjoyment: 2 })]
    const w2 = rank(profile(), ctx(), meh).ranked.find((s) => s.activity.id === 'brisk_walk_loop')!
    expect(evidenceFacts(w2, ctx()).join(' ')).not.toMatch(/rated this/)
    const none = rank(profile(), ctx(), []).ranked.find((s) => s.activity.id === 'brisk_walk_loop')!
    expect(none.evidence.observed_enjoyment_avg).toBeNull()
    expect(evidenceFacts(none, ctx()).join(' ')).not.toMatch(/rated this|finished this|last one/)
  })

  it('"likes X" and "X works at this time" are separate signals', () => {
    // Evening completions raise the evening time-fit of the family without changing what the person says they like.
    const evening = times(4, () => ({ ...ev('brisk_walk_loop', 'completed'), timestamp: `2026-09-1${n % 9}T18:00:00+05:30` }))
    const atEvening = rank(profile(), ctx({ hour: 18 }), evening).ranked.find((s) => s.activity.id === 'easy_jog')!
    const atDawn = rank(profile(), ctx({ hour: 6 }), evening).ranked.find((s) => s.activity.id === 'easy_jog')!
    expect(atEvening.components.time_fit).toBeGreaterThan(atDawn.components.time_fit)
    expect(atEvening.evidence.declared_like).toBeNull()
  })
})

describe('goals: a nudge that real behaviour can overrule', () => {
  const score = (p: UserProfile, id: string, h: HistoryEvent[] = []) => rank(p, ctx(), h).ranked.find((s) => s.activity.id === id)!

  it('raise activities that genuinely support the goal, and only those', () => {
    const base = profile()
    const moving = profile({ goals: ['move_more'] })
    for (const a of ACTIVITIES.filter((x) => x.id !== 'doorstep_reset')) {
      const b = rank(base, ctx(), []).ranked.find((s) => s.activity.id === a.id)
      const g = rank(moving, ctx(), []).ranked.find((s) => s.activity.id === a.id)
      if (!b || !g) continue
      if (a.family === 'movement') expect(g.score, a.id).toBeGreaterThan(b.score)
      else expect(g.score, a.id).toBe(b.score)
    }
  })

  it('cite the goal in the reason only when that is the real basis', () => {
    const p = profile({ goals: ['feel_calmer'] })
    const calm = score(p, 'park_sit_and_watch')
    expect(calm.evidence.declared_goal).toBe('feel_calmer')
    expect(evidenceFacts(calm, ctx())).toContain('It fits your goal to feel calmer.')
    const notCalm = score(p, 'football_kickabout')
    expect(notCalm.evidence.declared_goal).toBeNull()
    expect(evidenceFacts(notCalm, ctx()).join(' ')).not.toMatch(/goal/)
  })

  it('never beat what the person actually does', () => {
    const p = profile({ goals: ['move_more'], preferences: { likes: ['walking'], dislikes: [], preferred_duration_min: 45, social_preference: 'any' } })
    const skipped = times(6, () => ev('brisk_walk_loop', 'skipped', { skip_reason: 'boring' }))
    const done = times(6, () => ev('stretch_flow', 'completed', { enjoyment: 5 }))
    const r = rank(p, ctx(), [...skipped, ...done]).ranked.map((s) => s.activity.id)
    expect(r.indexOf('stretch_flow')).toBeLessThan(r.indexOf('brisk_walk_loop'))
  })

  it('profiles without goals (saved before goals existed) behave exactly like an empty list', () => {
    const a = rank(profile(), ctx(), []).ranked.map((s) => [s.activity.id, s.score])
    const b = rank(profile({ goals: [] }), ctx(), []).ranked.map((s) => [s.activity.id, s.score])
    expect(a).toEqual(b)
  })
})

describe('preparation comes only from real activity data', () => {
  it('lists exactly the equipment and optional extras the activity defines', () => {
    for (const a of ACTIVITIES) {
      const prep = preparationFor(a)
      expect(prep.length, a.id).toBe(a.equipment.length + a.bundles.length)
      expect(new Set(prep).size, a.id).toBe(prep.length)
      expect(prep.filter((p) => !p.startsWith('Optional')).length, a.id).toBe(a.equipment.length)
      for (const p of prep) expect(p.length, a.id).toBeGreaterThan(3)
    }
  })

  it('a racket game needs a racket; a plain walk needs nothing mandatory', () => {
    expect(preparationFor(getActivity('badminton_game')!)).toContain('Your racket')
    expect(preparationFor(getActivity('doorstep_reset')!).filter((p) => !p.startsWith('Optional'))).toEqual([])
  })

  it('is on the recommendation itself', () => {
    const rec = planDeterministic(profile(), ctx(), []).recommendation
    expect(rec.preparation).toEqual(preparationFor(getActivity(rec.activity_id)!))
  })
})
