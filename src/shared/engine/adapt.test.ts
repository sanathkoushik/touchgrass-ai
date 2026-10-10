import { describe, expect, it } from 'vitest'
import { chooseMode, evidenceFacts, getActivity, planDeterministic, rank, type Context, type HistoryEvent, type LearnedSignal, type UserProfile } from './index'

// Synthetic fixtures only.
const ALL_GEAR = ['bicycle', 'racket', 'ball', 'swimwear', 'yoga_mat', 'sketchbook', 'cards', 'trash_bag'] as const
const profile = (over: Partial<UserProfile> = {}): UserProfile => ({
  user_id: 'u',
  preferences: { likes: [], dislikes: [], preferred_duration_min: 30, social_preference: 'any' },
  motivators: [],
  avoidances: [],
  equipment: [...ALL_GEAR],
  ...over,
})
const ctx = (over: Partial<Context> = {}): Context => ({ duration_limit: 120, social_available: true, mood: 'ok', hour: 12, weather: { category: 'clear', temp_c: 24 }, ...over })

let n = 0
const ev = (activity_id: string, over: Partial<HistoryEvent> = {}): HistoryEvent => {
  n += 1
  return { activity_id, timestamp: `2026-09-${String(1 + (n % 27)).padStart(2, '0')}T12:${String(n % 60).padStart(2, '0')}:00+05:30`, outcome: 'completed', ...over }
}
const rankOf = (c: Context, h: HistoryEvent[] = [], p = profile()) => rank(p, c, h).ranked
const position = (list: { activity: { id: string } }[], id: string) => list.findIndex((s) => s.activity.id === id)
const sig = (kind: LearnedSignal['kind'], key: string, strength: LearnedSignal['strength'] = 'tentative', text = 'A learned pattern.'): LearnedSignal => ({ id: `${kind}:${key}`, kind, key, strength, text })

describe('desired outcome (the daily check-in)', () => {
  it('"clear my head" favours calm, quiet missions over intense ones', () => {
    const r = rankOf(ctx({ desired_outcome: 'clear_head' }))
    expect(position(r, 'quiet_reset')).toBeLessThan(position(r, 'bodyweight_park_circuit'))
    expect(position(r, 'park_sit_and_watch')).toBeLessThan(position(r, 'easy_jog'))
  })

  it('"feel more energetic" favours active missions', () => {
    const r = rankOf(ctx({ desired_outcome: 'energise' }))
    expect(position(r, 'easy_jog')).toBeLessThan(position(r, 'park_sit_and_watch'))
  })

  it('"break the routine" favours new-feeling missions', () => {
    const r = rankOf(ctx({ desired_outcome: 'break_routine' }))
    expect(position(r, 'neighbourhood_scavenger_hunt')).toBeLessThan(position(r, 'brisk_walk_loop'))
  })

  it('"feel connected" favours missions with other people when someone is free', () => {
    const r = rankOf(ctx({ desired_outcome: 'connect', social_available: true }))
    expect(position(r, 'walk_and_talk')).toBeLessThan(position(r, 'stretch_flow'))
  })

  it('says so truthfully in the reason only when the fit is genuine', () => {
    const calm = planDeterministic(profile(), ctx({ desired_outcome: 'clear_head', duration_limit: 20, mood: 'ok' }), []).recommendation
    expect(calm.reason).toContain('You wanted to clear your head')
    const none = planDeterministic(profile(), ctx(), []).recommendation
    expect(none.reason).not.toMatch(/You wanted/)
  })

  it('has no effect at all when nothing was chosen', () => {
    for (const s of rankOf(ctx())) {
      expect(s.components.outcome_fit).toBe(0)
      expect(s.evidence.outcome_fit).toBeNull()
    }
  })

  it('never overrides hard constraints (time, dislikes)', () => {
    const r = rankOf(ctx({ desired_outcome: 'energise', duration_limit: 10 }), [], profile({ preferences: { likes: [], dislikes: ['running'], preferred_duration_min: 30, social_preference: 'any' } }))
    for (const s of r) {
      expect(s.activity.duration.min).toBeLessThanOrEqual(10)
      expect(s.activity.tags).not.toContain('running')
    }
  })
})

describe('what was learned shapes the next suggestion', () => {
  it('"enjoys exploring" lifts exploring missions', () => {
    const without = rankOf(ctx())
    const withLearned = rankOf(ctx({ learned: [sig('enjoys_kind', 'exploration')] }))
    const gap = (r: typeof without) => position(r, 'brisk_walk_loop') - position(r, 'new_street_walk')
    expect(gap(withLearned)).toBeGreaterThan(gap(without))
  })

  it('"evenings have been harder to start" favours short missions in the evening, and not at other times', () => {
    const learned = [sig('hard_time', 'part:evenings')]
    const evening = rankOf(ctx({ learned, hour: 19 }))
    const comp = (r: typeof evening, id: string) => r.find((s) => s.activity.id === id)!.components.learned
    expect(comp(evening, 'doorstep_reset')).toBeGreaterThan(0) // 5 minutes: easy to begin
    expect(comp(evening, 'cards_outside')).toBeLessThan(0) // an hour: harder to begin
    const evComp = comp(evening, 'cards_outside')
    const morningComp = comp(rankOf(ctx({ learned, hour: 9 })), 'cards_outside')
    expect(evComp).toBeLessThan(0)
    expect(morningComp).toBe(0)
  })

  it('applies weekday/weekend patterns using the person\'s own day', () => {
    const learned = [sig('hard_time', 'day:weekday')]
    const weekday = rankOf(ctx({ learned, weekend: false })).find((s) => s.activity.id === 'cycling_ride')!.components.learned
    const weekend = rankOf(ctx({ learned, weekend: true })).find((s) => s.activity.id === 'cycling_ride')!.components.learned
    expect(weekday).toBeLessThan(0)
    expect(weekend).toBe(0)
  })

  it('"shorter missions feel manageable" favours short ones', () => {
    const r = rankOf(ctx({ learned: [sig('duration_fit', 'short')] }))
    const comp = (id: string) => r.find((s) => s.activity.id === id)!.components.learned
    expect(comp('stretch_flow')).toBeGreaterThan(0)
    expect(comp('nature_trail_hike')).toBeLessThan(0)
  })

  it('a barrier is answered by what avoids it (hard to start -> small; too far -> no travel; bad weather -> any weather)', () => {
    const comp = (key: string, id: string) => rankOf(ctx({ learned: [sig('barrier', key)] })).find((s) => s.activity.id === id)!.components.learned
    expect(comp('couldnt_start', 'doorstep_reset')).toBeGreaterThan(0)
    expect(comp('couldnt_start', 'nature_trail_hike')).toBe(0)
    expect(comp('too_far', 'brisk_walk_loop')).toBeGreaterThan(0)
    expect(comp('bad_weather', 'stretch_flow')).toBeGreaterThan(0)
    expect(comp('bad_weather', 'easy_jog')).toBe(0)
  })

  it('appeal patterns lift what they describe', () => {
    const comp = (key: string, id: string, extra: Partial<Context> = {}) => rankOf(ctx({ learned: [sig('appeal', key)], ...extra })).find((s) => s.activity.id === id)!.components.learned
    expect(comp('novelty', 'neighbourhood_scavenger_hunt')).toBeGreaterThan(0)
    expect(comp('novelty', 'brisk_walk_loop')).toBeLessThan(0)
    expect(comp('company', 'walk_and_talk')).toBeGreaterThan(0)
    expect(comp('observation', 'park_sit_and_watch')).toBeGreaterThan(0)
    expect(comp('movement', 'easy_jog')).toBeGreaterThan(0)
  })

  it('"repetitive", "skipped often" and "no change" gently lower that one activity only', () => {
    for (const kind of ['repetitive', 'skipped_often', 'no_change'] as const) {
      const r = rankOf(ctx({ learned: [sig(kind, 'brisk_walk_loop')] }))
      expect(r.find((s) => s.activity.id === 'brisk_walk_loop')!.components.learned, kind).toBeLessThan(0)
      expect(r.find((s) => s.activity.id === 'easy_jog')!.components.learned, kind).toBe(0)
    }
  })

  it('a consistent pattern counts for more than a tentative one', () => {
    const t = rankOf(ctx({ learned: [sig('enjoys_kind', 'exploration', 'tentative')] })).find((s) => s.activity.id === 'new_street_walk')!.components.learned
    const c = rankOf(ctx({ learned: [sig('enjoys_kind', 'exploration', 'consistent')] })).find((s) => s.activity.id === 'new_street_walk')!.components.learned
    expect(c).toBeGreaterThan(t)
  })

  it('quotes the pattern in the reason when it genuinely helped, and not otherwise', () => {
    const text = 'You seem to enjoy exploring and discovering new things more than repeating the same route.'
    const favoured = rankOf(ctx({ learned: [sig('enjoys_kind', 'exploration', 'tentative', text)] })).find((s) => s.activity.id === 'new_street_walk')!
    expect(favoured.evidence.learned_text).toBe(text)
    expect(evidenceFacts(favoured, ctx())).toContain(text)
    const other = rankOf(ctx({ learned: [sig('enjoys_kind', 'exploration', 'tentative', text)] })).find((s) => s.activity.id === 'easy_jog')!
    expect(other.evidence.learned_text).toBeNull()
  })

  it('never lets learning push a score outside its range, whatever it has learned', () => {
    const everything = [sig('enjoys_kind', 'movement', 'consistent'), sig('appeal', 'novelty', 'consistent'), sig('appeal', 'observation', 'consistent'), sig('calming', 'calmer', 'consistent'), sig('duration_fit', 'short', 'consistent'), sig('barrier', 'couldnt_start', 'consistent'), sig('barrier', 'too_tired', 'consistent')]
    for (const s of rankOf(ctx({ learned: everything }))) {
      expect(s.components.learned).toBeGreaterThanOrEqual(-1)
      expect(s.components.learned).toBeLessThanOrEqual(1)
    }
  })

  it('does nothing when nothing has been learned', () => {
    for (const s of rankOf(ctx())) {
      expect(s.components.learned).toBe(0)
      expect(s.evidence.learned_text).toBeNull()
    }
  })
})

describe('single answers are hints, not verdicts', () => {
  it('"would not repeat" lowers that activity, "would repeat" lifts it slightly, and neither removes anything', () => {
    const no = rankOf(ctx(), [ev('brisk_walk_loop', { would_repeat: 'no' })])
    expect(no.find((s) => s.activity.id === 'brisk_walk_loop')!.components.learned).toBeLessThan(0)
    expect(no.some((s) => s.activity.id === 'brisk_walk_loop')).toBe(true) // still a candidate: it only ranks lower
    const yes = rankOf(ctx(), [ev('brisk_walk_loop', { would_repeat: 'yes' })])
    expect(yes.find((s) => s.activity.id === 'brisk_walk_loop')!.components.learned).toBeGreaterThan(0)
  })

  it('"felt the same" nudges toward something different, and is not treated as a failure', () => {
    const r = rankOf(ctx(), [ev('brisk_walk_loop', { feeling: 'same' })])
    const walk = r.find((s) => s.activity.id === 'brisk_walk_loop')!
    expect(walk.components.learned).toBeLessThan(0)
    expect(walk.components.preference).toBeGreaterThanOrEqual(rankOf(ctx())[0]!.components.preference - 2) // preference itself untouched
    expect(walk.components.friction).toBe(0) // not counted as a barrier
  })

  it('"more tired afterwards" leans the next ones gentler', () => {
    const r = rankOf(ctx(), [ev('easy_jog', { feeling: 'more_tired' })])
    expect(r.find((s) => s.activity.id === 'stair_climb')!.components.learned).toBeLessThan(0)
    expect(r.find((s) => s.activity.id === 'park_sit_and_watch')!.components.learned).toBe(0)
  })

  it('"too tired" answers favour missions that can be done sitting down, and the reason says so', () => {
    const history = [ev('easy_jog', { outcome: 'skipped', skip_reason: 'too_tired' })]
    const r = rankOf(ctx(), history)
    expect(r.find((s) => s.activity.id === 'park_sit_and_watch')!.components.learned).toBeGreaterThan(0)
    const seated = r.find((s) => s.activity.id === 'park_sit_and_watch')!
    expect(evidenceFacts(seated, ctx())).toContain('You said the last one wore you out; this one can be done sitting down.')
  })

  it('"I could not get started" favours small missions, and the reason says so', () => {
    const history = [ev('nature_trail_hike', { outcome: 'skipped', skip_reason: 'couldnt_start' })]
    const r = rankOf(ctx(), history)
    expect(r.find((s) => s.activity.id === 'doorstep_reset')!.components.learned).toBeGreaterThan(0)
    const small = r.find((s) => s.activity.id === 'stretch_flow')!
    expect(small.evidence.addresses_skip).toBe('couldnt_start')
    expect(evidenceFacts(small, ctx())).toContain('You found the last one hard to start; this one is small and easy to begin.')
    expect(r.find((s) => s.activity.id === 'nature_trail_hike')!.components.friction).toBeLessThan(0)
  })

  it('ignores answers that are older than the last couple when nudging for energy or starting', () => {
    const old = [ev('easy_jog', { outcome: 'skipped', skip_reason: 'couldnt_start' }), ev('a'), ev('b'), ev('c')].sort((x, y) => (x.timestamp < y.timestamp ? 1 : -1))
    const r = rankOf(ctx(), [...old])
    // Only the few newest answers can nudge; a long-ago skip does not.
    const doorstep = r.find((s) => s.activity.id === 'doorstep_reset')!
    expect(doorstep.components.learned).toBeLessThanOrEqual(0.2)
  })
})

describe('"I could not get started" makes the next beginning tiny', () => {
  it('chooseMode picks a small start with its own reason', () => {
    expect(chooseMode([ev('nature_trail_hike', { outcome: 'skipped', skip_reason: 'couldnt_start' })], 'ok')).toEqual({ mode: 'minimum', cause: 'hard_start' })
    expect(chooseMode([ev('easy_jog', { barrier: 'couldnt_start' })], 'ok')).toEqual({ mode: 'minimum', cause: 'hard_start' })
  })

  it('two skips in a row is still recovery (it takes precedence)', () => {
    expect(chooseMode([ev('a', { outcome: 'skipped' }), ev('b', { outcome: 'skipped', skip_reason: 'couldnt_start' })], 'ok').cause).toBe('recovery')
  })

  it('an older "could not start" does not keep forcing small starts', () => {
    const history = [ev('a', { outcome: 'skipped', skip_reason: 'couldnt_start' }), ev('b'), ev('c')]
    const sorted = [...history].sort((x, y) => (x.timestamp < y.timestamp ? -1 : 1))
    // newest is a completed one
    expect(chooseMode([sorted[0]!, { ...sorted[1]!, timestamp: '2026-12-01T10:00:00+05:30' }], 'ok')).toEqual({ mode: 'normal' })
  })

  it('the reason says what is happening, kindly', () => {
    const history = [ev('nature_trail_hike', { outcome: 'skipped', skip_reason: 'couldnt_start' })]
    const { mode, cause } = chooseMode(history, 'ok')
    const rec = planDeterministic(profile(), ctx({ mode, mode_cause: cause }), history).recommendation
    expect(rec.reason).toContain('Last time, starting was the hard part, so this one begins with just two minutes.')
    expect(rec.reason).not.toMatch(/fail|lazy|should/i)
  })
})

describe('things the person asked never to see again', () => {
  it('are never suggested, and never the fallback either (unless nothing else exists)', () => {
    const p = profile({ avoid_activities: ['brisk_walk_loop', 'easy_jog'] })
    for (let h = 0; h < 24; h++) {
      for (const mood of ['low', 'ok', 'high'] as const) {
        const rec = planDeterministic(p, ctx({ hour: h, mood }), []).recommendation
        expect(['brisk_walk_loop', 'easy_jog']).not.toContain(rec.activity_id)
        expect(rec.fallback?.activity_id).not.toBe('brisk_walk_loop')
      }
    }
  })

  it('explains the rejection and still guarantees an answer when everything is avoided', () => {
    const all = profile({ avoid_activities: ['brisk_walk_loop'] })
    const r = rank(all, ctx(), [])
    expect(r.rejected.find((x) => x.activity_id === 'brisk_walk_loop')?.reasons).toContain('asked not to see this again')
    const everything = profile({ avoid_activities: ['doorstep_reset', ...['brisk_walk_loop']] })
    expect(planDeterministic(everything, ctx(), []).recommendation.title.length).toBeGreaterThan(3)
  })

  it('is empty-safe for profiles saved before this existed', () => {
    expect(planDeterministic(profile({ avoid_activities: undefined }), ctx(), []).recommendation.title.length).toBeGreaterThan(3)
    expect(getActivity('quiet_reset')).toBeTruthy()
  })
})
