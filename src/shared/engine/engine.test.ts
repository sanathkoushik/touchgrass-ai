import { describe, expect, it } from 'vitest'
import {
  evidenceFacts,
  ACTIVITIES,
  GUARANTEED_FALLBACK_ID,
  filterActivities,
  getActivity,
  planDeterministic,
  rank,
  rejectionReasons,
  type Context,
  type HistoryEvent,
  type UserProfile,
  type Weather,
} from './index'
import { hourOf } from './score'

// ------------------------------------------------------------ test fixtures
// These are synthetic profiles used ONLY to exercise the engine in tests. They are never shown in the app.

const baseProfile = (over: Partial<UserProfile> = {}): UserProfile => ({
  user_id: 'test_user',
  preferences: {
    likes: [],
    dislikes: [],
    preferred_duration_min: 45,
    social_preference: 'any',
  },
  motivators: [],
  avoidances: [],
  equipment: [],
  ...over,
})

const baseCtx = (over: Partial<Context> = {}): Context => ({
  duration_limit: 60,
  social_available: false,
  mood: 'ok',
  hour: 17,
  weather: { category: 'clear', temp_c: 24 },
  ...over,
})

let t = 0
/** Builds history with strictly increasing timestamps (oldest first). */
const ev = (
  activity_id: string,
  outcome: HistoryEvent['outcome'],
  extra: Partial<HistoryEvent> = {},
): HistoryEvent => {
  t += 1
  const day = String(1 + Math.floor(t / 4)).padStart(2, '0')
  const hour = String(17 + (t % 3)).padStart(2, '0')
  return { activity_id, timestamp: `2026-09-${day}T${hour}:00:00+05:30`, outcome, ...extra }
}

const ids = (r: { ranked: { activity: { id: string } }[] }) => r.ranked.map((s) => s.activity.id)

// ------------------------------------------------------------ catalog sanity

describe('activity catalog', () => {
  it('has 20-40 activities with unique ids', () => {
    expect(ACTIVITIES.length).toBeGreaterThanOrEqual(20)
    expect(ACTIVITIES.length).toBeLessThanOrEqual(40)
    expect(new Set(ACTIVITIES.map((a) => a.id)).size).toBe(ACTIVITIES.length)
  })

  it('covers all three activity families', () => {
    for (const family of ['movement', 'exploration', 'social_skill'] as const) {
      expect(ACTIVITIES.filter((a) => a.family === family).length).toBeGreaterThanOrEqual(5)
    }
  })

  it('has internally consistent records', () => {
    for (const a of ACTIVITIES) {
      expect(a.duration.min, a.id).toBeLessThanOrEqual(a.duration.default)
      expect(a.duration.default, a.id).toBeLessThanOrEqual(a.duration.max)
      expect(a.firstStep.length, a.id).toBeGreaterThan(10)
      expect(a.social.length, a.id).toBeGreaterThan(0)
      // An activity that needs others must not claim to support solo.
      if (a.needsOthers) expect(a.social, a.id).not.toContain('solo')
      else expect(a.social, a.id).toContain('solo')
    }
  })
})

// ---------------------------------------------------------- hard constraints

describe('hard-constraint filter (no LLM needed)', () => {
  it('removes activities that need more time than available', () => {
    const { candidates } = filterActivities(ACTIVITIES, baseProfile(), baseCtx({ duration_limit: 20 }))
    for (const a of candidates) expect(a.duration.min).toBeLessThanOrEqual(20)
    expect(candidates.find((a) => a.id === 'nature_trail_hike')).toBeUndefined()
  })

  it('removes activities that need people when nobody is free', () => {
    const { candidates } = filterActivities(ACTIVITIES, baseProfile({ equipment: ['racket', 'cards'] }), baseCtx({ social_available: false }))
    expect(candidates.find((a) => a.id === 'badminton_game')).toBeUndefined()
    expect(candidates.find((a) => a.id === 'walk_and_talk')).toBeUndefined()
    expect(candidates.find((a) => a.id === 'cards_outside')).toBeUndefined()
  })

  it('allows social activities once a friend is free and gear is owned', () => {
    const { candidates } = filterActivities(ACTIVITIES, baseProfile({ equipment: ['racket'] }), baseCtx({ social_available: true }))
    expect(candidates.find((a) => a.id === 'badminton_game')).toBeDefined()
  })

  it('removes activities whose equipment the user does not own', () => {
    const r = rejectionReasons(getActivity('cycling_ride')!, baseProfile({ equipment: [] }), baseCtx())
    expect(r.join(' ')).toContain('missing equipment: bicycle')
  })

  it('explicit dislikes override everything (including stems like running/jog)', () => {
    const p = baseProfile({ preferences: { ...baseProfile().preferences, likes: ['running'], dislikes: ['running'] } })
    const { candidates } = filterActivities(ACTIVITIES, p, baseCtx())
    expect(candidates.find((a) => a.id === 'easy_jog')).toBeUndefined()
  })

  it('dislike "walk" also removes "walking" activities', () => {
    const p = baseProfile({ preferences: { ...baseProfile().preferences, dislikes: ['walk'] } })
    const { candidates } = filterActivities(ACTIVITIES, p, baseCtx())
    expect(candidates.filter((a) => a.tags.includes('walking'))).toHaveLength(0)
  })

  it('respects the too_far and high_cost avoidances', () => {
    const { candidates } = filterActivities(ACTIVITIES, baseProfile({ avoidances: ['too_far'] }), baseCtx({ duration_limit: 300 }))
    expect(candidates.find((a) => a.travel === 'far')).toBeUndefined()
  })

  it('rules out the most intense options when energy is low', () => {
    const { candidates } = filterActivities(ACTIVITIES, baseProfile(), baseCtx({ mood: 'low' }))
    expect(candidates.find((a) => a.intensity === 3)).toBeUndefined()
  })

  it('uses real light conditions: night-only vs day-only activities', () => {
    const night = baseCtx({ hour: 20, is_daylight: false })
    const day = baseCtx({ hour: 12, is_daylight: true })
    expect(rejectionReasons(getActivity('rooftop_stargazing')!, baseProfile(), night)).toEqual([])
    expect(rejectionReasons(getActivity('rooftop_stargazing')!, baseProfile(), day)).toContain('needs darkness')
    expect(rejectionReasons(getActivity('sunset_spot_hunt')!, baseProfile(), night)).toContain('needs daylight')
  })

  it('does not send anyone travelling in the middle of the night', () => {
    const { candidates } = filterActivities(ACTIVITIES, baseProfile(), baseCtx({ hour: 2, is_daylight: false }))
    expect(candidates.every((a) => a.travel === 'none')).toBe(true)
    expect(candidates.length).toBeGreaterThan(0)
  })

  it('explains every rejection', () => {
    const { candidates, rejected } = filterActivities(ACTIVITIES, baseProfile(), baseCtx({ duration_limit: 20 }))
    expect(candidates.length + rejected.length).toBe(ACTIVITIES.length)
    for (const r of rejected) expect(r.reasons.length).toBeGreaterThan(0)
  })
})

describe('weather', () => {
  const rain: Weather = { category: 'rain', temp_c: 22 }
  const hot: Weather = { category: 'clear', temp_c: 38 }
  const clear: Weather = { category: 'clear', temp_c: 24 }
  const cloudy: Weather = { category: 'cloudy', temp_c: 24 }

  it('rain removes dry-only and fair-only activities but keeps sheltered ones', () => {
    const { candidates } = filterActivities(ACTIVITIES, baseProfile({ equipment: ['racket'] }), baseCtx({ weather: rain, social_available: true }))
    const set = new Set(candidates.map((a) => a.id))
    expect(set.has('brisk_walk_loop')).toBe(false)
    expect(set.has('easy_jog')).toBe(false)
    expect(set.has('stretch_flow')).toBe(true)
    expect(set.has('badminton_game')).toBe(true) // indoor court
  })

  it('extreme heat removes "fair" activities but allows plain walks', () => {
    const jog = rejectionReasons(getActivity('easy_jog')!, baseProfile(), baseCtx({ weather: hot }))
    const walk = rejectionReasons(getActivity('brisk_walk_loop')!, baseProfile(), baseCtx({ weather: hot }))
    expect(jog.join(' ')).toContain('comfortable range')
    expect(walk).toEqual([])
  })

  it('stargazing needs a clear sky, not just darkness', () => {
    const night = { hour: 21, is_daylight: false }
    expect(rejectionReasons(getActivity('rooftop_stargazing')!, baseProfile(), baseCtx({ ...night, weather: clear }))).toEqual([])
    expect(rejectionReasons(getActivity('rooftop_stargazing')!, baseProfile(), baseCtx({ ...night, weather: cloudy })).join(' ')).toContain('sky is not clear')
  })

  it('missing weather data never blocks the engine', () => {
    const r = rank(baseProfile(), baseCtx({ weather: undefined }))
    expect(r.ranked.length).toBeGreaterThan(5)
  })

  it('the same user gets different recommendations in different weather', () => {
    const p = baseProfile({ preferences: { ...baseProfile().preferences, likes: ['walking'] } })
    const sunny = planDeterministic(p, baseCtx({ weather: clear })).recommendation
    const wet = planDeterministic(p, baseCtx({ weather: rain })).recommendation
    expect(sunny.activity_id).not.toBe(wet.activity_id)
  })
})

// --------------------------------------------------------------- guarantees

describe('the engine can never come up empty', () => {
  it('doorstep_reset passes the filter in every weather, hour and mood', () => {
    const activity = getActivity(GUARANTEED_FALLBACK_ID)!
    const weathers: (Weather | undefined)[] = [
      undefined,
      { category: 'storm', temp_c: 5 },
      { category: 'snow', temp_c: -5 },
      { category: 'clear', temp_c: 45 },
    ]
    for (const weather of weathers) {
      for (let hour = 0; hour < 24; hour++) {
        for (const mood of ['low', 'ok', 'high'] as const) {
          const reasons = rejectionReasons(activity, baseProfile(), baseCtx({ weather, hour, mood, duration_limit: 5, social_available: false }))
          expect(reasons, `${hour}h ${mood} ${weather?.category}`).toEqual([])
        }
      }
    }
  })

  it('falls back to the guaranteed activity when the filter leaves nothing', () => {
    // Hostile case: only 5 minutes at 3am, and the user dislikes everything that could still pass the filter.
    const p = baseProfile({
      preferences: { ...baseProfile().preferences, dislikes: ['minimum', 'breathing', 'mindfulness'] },
    })
    const ctx = baseCtx({ duration_limit: 5, hour: 3, is_daylight: false, weather: { category: 'storm', temp_c: 10 } })
    const { ranking, recommendation } = planDeterministic(p, ctx)
    expect(ranking.usedGuaranteedFallback).toBe(true)
    expect(recommendation.activity_id).toBe(GUARANTEED_FALLBACK_ID)
    expect(recommendation.first_step.length).toBeGreaterThan(5)
  })

  it('always returns a recommendation that fits the available time', () => {
    for (const limit of [5, 10, 20, 45, 90, 240]) {
      const { recommendation } = planDeterministic(baseProfile(), baseCtx({ duration_limit: limit }))
      expect(recommendation.duration_min).toBeLessThanOrEqual(Math.max(limit, 5))
      expect(recommendation.first_step.length).toBeGreaterThan(5)
    }
  })

  it('is deterministic: same input, same output', () => {
    const p = baseProfile({ motivators: ['novelty'] })
    const h = [ev('brisk_walk_loop', 'completed', { enjoyment: 4 })]
    const a = planDeterministic(p, baseCtx(), h).recommendation
    const b = planDeterministic(p, baseCtx(), h).recommendation
    expect(a).toEqual(b)
  })
})

// ------------------------------------------------------ personalisation/learning

describe('different users get different recommendations', () => {
  it('a social competitor and a quiet creative are not given the same activity', () => {
    const competitor = baseProfile({
      preferences: { likes: ['badminton'], dislikes: [], preferred_duration_min: 60, social_preference: 'small_group' },
      motivators: ['social', 'competition'],
      equipment: ['racket'],
    })
    const creative = baseProfile({
      preferences: { likes: ['photography', 'drawing'], dislikes: [], preferred_duration_min: 40, social_preference: 'solo' },
      motivators: ['creativity', 'calm'],
      equipment: ['sketchbook'],
    })
    const ctx = baseCtx({ social_available: true })
    const a = planDeterministic(competitor, ctx).recommendation
    const b = planDeterministic(creative, ctx).recommendation
    expect(a.activity_id).toBe('badminton_game')
    expect(a.activity_id).not.toBe(b.activity_id)
    expect(['photo_walk_challenge', 'sunset_spot_hunt', 'outdoor_sketching', 'waterfront_walk', 'neighbourhood_scavenger_hunt']).toContain(b.activity_id)
  })
})

describe('observed behaviour beats stated preference (report 19.1)', () => {
  const profile = baseProfile({
    preferences: { likes: ['running', 'badminton', 'photography'], dislikes: [], preferred_duration_min: 60, social_preference: 'any' },
    motivators: ['novelty', 'social'],
    equipment: ['racket'],
  })
  const ctx = baseCtx({ social_available: true })

  it('with no history the declared goal wins on its own merit', () => {
    const r = rank(profile, ctx, [])
    const run = r.ranked.find((s) => s.activity.id === 'easy_jog')!
    expect(run.evidence.declared_like).toBe('running')
  })

  it('a liked activity that is always skipped drops below one that always gets done', () => {
    const history = [
      ev('easy_jog', 'skipped', { skip_reason: 'too_tired' }),
      ev('badminton_game', 'completed', { enjoyment: 5 }),
      ev('easy_jog', 'skipped', { skip_reason: 'too_tired' }),
      ev('badminton_game', 'completed', { enjoyment: 5 }),
      ev('easy_jog', 'skipped', { skip_reason: 'boring' }),
      ev('easy_jog', 'skipped', { skip_reason: 'too_tired' }),
      ev('badminton_game', 'completed', { enjoyment: 4 }),
    ]
    const r = rank(profile, ctx, history)
    const order = ids(r)
    expect(order.indexOf('badminton_game')).toBeLessThan(order.indexOf('easy_jog'))

    const run = r.ranked.find((s) => s.activity.id === 'easy_jog')!
    expect(run.components.preference).toBeLessThan(0.1)
  })

  it('feedback moves rankings in the right direction', () => {
    const before = rank(profile, ctx, [])
    // Skip the best non-badminton option, so the test is not contradicting itself.
    const skipped = before.ranked.find((r) => r.activity.id !== 'badminton_game')!.activity.id
    const history = [
      ev(skipped, 'skipped', { skip_reason: 'boring' }),
      ev(skipped, 'skipped', { skip_reason: 'boring' }),
      ev('badminton_game', 'completed', { enjoyment: 5 }),
      ev('badminton_game', 'completed', { enjoyment: 5 }),
    ]
    const after = rank(profile, ctx, history)
    const pos = (r: ReturnType<typeof rank>, id: string) => ids(r).indexOf(id)
    expect(pos(after, skipped)).toBeGreaterThan(pos(before, skipped))
    expect(pos(after, 'badminton_game')).toBeLessThanOrEqual(pos(before, 'badminton_game'))
    expect(after.ranked[0]!.activity.id).not.toBe(skipped)
  })

  it('success can only raise the preference for an activity, never lower it', () => {
    const pref = (hist: HistoryEvent[]) => rank(profile, ctx, hist).ranked.find((s) => s.activity.id === 'badminton_game')!.components.preference
    const none = pref([])
    const one = pref([ev('badminton_game', 'completed')])
    const two = pref([ev('badminton_game', 'completed'), ev('badminton_game', 'completed')])
    expect(one).toBeGreaterThanOrEqual(none)
    expect(two).toBeGreaterThanOrEqual(one)
  })

  it('cites real past completions in the reason when they exist', () => {
    const p = baseProfile({ preferences: { ...baseProfile().preferences, likes: ['walking'] } })
    const history = [
      ev('brisk_walk_loop', 'completed', { enjoyment: 4 }),
      ev('brisk_walk_loop', 'completed', { enjoyment: 5 }),
      ev('brisk_walk_loop', 'completed', { enjoyment: 4 }),
      ev('stretch_flow', 'completed', { enjoyment: 3 }),
    ]
    const reason = planDeterministic(p, baseCtx(), history).recommendation
    const walk = rank(p, baseCtx(), history).ranked.find((s) => s.activity.id === 'brisk_walk_loop')!
    expect(walk.evidence.observed_n).toBe(3)
    expect(walk.evidence.observed_done).toBe(3)
    if (reason.activity_id === 'brisk_walk_loop') {
      expect(reason.reason).toContain('finished this 3 of 3 times')
    }
  })
})

describe('skip reasons shape later choices', () => {
  it('"too far" pushes far-away options down', () => {
    const p = baseProfile()
    const ctx = baseCtx({ duration_limit: 240 })
    const clean = rank(p, ctx, [])
    const hist = [ev('nature_trail_hike', 'skipped', { skip_reason: 'too_far' }), ev('nature_trail_hike', 'skipped', { skip_reason: 'too_far' })]
    const learned = rank(p, ctx, hist)
    const pos = (r: ReturnType<typeof rank>) => ids(r).indexOf('nature_trail_hike')
    expect(pos(learned)).toBeGreaterThan(pos(clean))
  })

  it('"no friend" penalises activities that need others, not solo ones', () => {
    const p = baseProfile({ equipment: ['racket'] })
    const ctx = baseCtx({ social_available: true })
    const hist = [ev('badminton_game', 'skipped', { skip_reason: 'no_friend' })]
    const r = rank(p, ctx, hist)
    expect(r.ranked.find((s) => s.activity.id === 'badminton_game')!.components.friction).toBeLessThan(0)
    expect(r.ranked.find((s) => s.activity.id === 'brisk_walk_loop')!.components.friction).toBe(0)
  })

  it('does not just repeat what was suggested a moment ago', () => {
    const p = baseProfile({ preferences: { ...baseProfile().preferences, likes: ['walking'] } })
    const first = planDeterministic(p, baseCtx()).recommendation
    const next = planDeterministic(p, baseCtx(), [ev(first.activity_id, 'changed')]).recommendation
    expect(next.activity_id).not.toBe(first.activity_id)
  })
})

describe('mood', () => {
  it('prefers gentle activities when energy is low', () => {
    const { recommendation } = planDeterministic(baseProfile(), baseCtx({ mood: 'low' }))
    expect(getActivity(recommendation.activity_id)!.intensity).toBe(1)
  })
})

// ----------------------------------------------------------- honest explanations

describe('explanations only state facts we have', () => {
  it('with no history and no likes, it never claims past success or a stated interest', () => {
    const { recommendation } = planDeterministic(baseProfile(), baseCtx())
    expect(recommendation.reason).not.toMatch(/finished|you said you like|worked for you/i)
  })

  it('never mentions "recent picks" when there is no history at all', () => {
    // A novelty-loving profile, so the novelty sentence would otherwise be tempting.
    const p = baseProfile({ motivators: ['novelty'], preferences: { ...baseProfile().preferences, likes: ['exploring'] } })
    for (const mood of ['low', 'ok', 'high'] as const) {
      const { recommendation } = planDeterministic(p, baseCtx({ mood, duration_limit: 90 }), [])
      expect(recommendation.reason).not.toMatch(/recent picks/i)
    }
  })

  it('mentions a friend only when one is actually free', () => {
    const p = baseProfile({ preferences: { ...baseProfile().preferences, social_preference: 'small_group' }, equipment: ['racket'] })
    const free = planDeterministic(p, baseCtx({ social_available: true })).recommendation.reason
    const alone = planDeterministic(p, baseCtx({ social_available: false })).recommendation.reason
    expect(alone).not.toMatch(/free to join/i)
    expect(free).toBeTypeOf('string')
  })

  it('the fallback option is easier than the main pick', () => {
    const { recommendation } = planDeterministic(baseProfile({ equipment: ['bicycle'] }), baseCtx({ duration_limit: 120 }))
    if (recommendation.fallback) {
      const main = getActivity(recommendation.activity_id)!
      const fb = getActivity(recommendation.fallback.activity_id)!
      expect(fb.intensity).toBeLessThanOrEqual(main.intensity)
      expect(fb.id).not.toBe(main.id)
    }
  })
})

describe('live conditions as true statements', () => {
  const factsFor = (id: string, ctx: Context) => {
    const profile = baseProfile({ equipment: ['bicycle', 'racket', 'ball', 'swimwear', 'yoga_mat', 'sketchbook', 'cards', 'trash_bag'] })
    const scored = rank(profile, ctx, []).ranked.find((s) => s.activity.id === id)
    expect(scored, `${id} should be a candidate`).toBeTruthy()
    return evidenceFacts(scored!, ctx)
  }

  it('states the real weather for an outdoor activity', () => {
    const facts = factsFor('brisk_walk_loop', baseCtx({ weather: { category: 'cloudy', temp_c: 23.6 } }))
    expect(facts).toContain('It is cloudy and 24 degrees outside.')
  })

  it('says the sky is clear for stargazing, and mentions nothing for sheltered activities', () => {
    const night = baseCtx({ hour: 21, is_daylight: false, weather: { category: 'clear', temp_c: 20 } })
    expect(factsFor('rooftop_stargazing', night)).toContain('The sky is clear right now.')
    expect(factsFor('stretch_flow', baseCtx({ weather: { category: 'clear', temp_c: 24 } })).join(' ')).not.toMatch(/outside|sky|degrees/i)
  })

  it('never mentions weather when it is unknown', () => {
    for (const a of ACTIVITIES) {
      const scored = rank(baseProfile({ equipment: ['bicycle', 'racket', 'ball', 'swimwear', 'yoga_mat', 'sketchbook', 'cards', 'trash_bag'] }), baseCtx({ weather: undefined, social_available: true, duration_limit: 300 }), []).ranked.find((s) => s.activity.id === a.id)
      if (scored) expect(evidenceFacts(scored, baseCtx({ weather: undefined })).join(' '), a.id).not.toMatch(/degrees|sky|outside/i)
    }
  })
})

describe('time-of-day parsing', () => {
  it('reads the stored wall-clock hour, ignoring the runtime timezone', () => {
    expect(hourOf('2026-10-07T17:42:00+05:30')).toBe(17)
    expect(hourOf('2026-10-07T05:05:00Z')).toBe(5)
    expect(hourOf('garbage')).toBe(12)
  })
})
