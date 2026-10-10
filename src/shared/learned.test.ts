import { describe, expect, it } from 'vitest'
import { ACTIVITIES } from './engine'
import { LEARNING_EXPLANATION, isWeekend, learnProfile, partOfDay, usableSignals, type LearnEvent } from './learned'

// Synthetic events only. 2026-10-10 is a Saturday, 2026-10-07 a Wednesday.

let n = 0
const ev = (activity_id: string, over: Partial<LearnEvent> = {}): LearnEvent => {
  n += 1
  return { activity_id, timestamp: `2026-10-07T10:${String(n % 60).padStart(2, '0')}:00+05:30`, outcome: 'completed', ...over }
}
const at = (timestamp: string, over: Partial<LearnEvent> = {}, activity_id = 'brisk_walk_loop'): LearnEvent => ({ activity_id, timestamp, outcome: 'completed', ...over })
const times = (k: number, make: (i: number) => LearnEvent) => Array.from({ length: k }, (_, i) => make(i))
const ids = (events: LearnEvent[], controls = {}) => learnProfile(events, controls).map((i) => i.id)

describe('it does not overreact', () => {
  it('learns nothing from no answers, unanswered missions, or one bad day', () => {
    expect(learnProfile([])).toEqual([])
    expect(learnProfile(times(10, () => ev('brisk_walk_loop', { outcome: 'pending' })))).toEqual([])
    expect(ids([ev('brisk_walk_loop', { outcome: 'skipped', skip_reason: 'too_tired' })])).toEqual([])
    expect(ids([ev('brisk_walk_loop', { outcome: 'skipped', skip_reason: 'couldnt_start' }), ev('easy_jog', { outcome: 'completed', enjoyment: 1 })])).toEqual([])
  })

  it('a single mention of a barrier is not a pattern; two are', () => {
    const one = [ev('easy_jog', { outcome: 'skipped', skip_reason: 'too_far' })]
    expect(ids(one)).not.toContain('barrier:too_far')
    const two = [...one, ev('easy_jog', { outcome: 'skipped', skip_reason: 'too_far' })]
    expect(ids(two)).toContain('barrier:too_far')
  })

  it('needs several ratings before saying what is enjoyed', () => {
    expect(ids([ev('new_street_walk', { enjoyment: 5 }), ev('brisk_walk_loop', { enjoyment: 2 })])).not.toContain('enjoys_kind:exploration')
  })

  it('says nothing when two kinds are enjoyed about equally', () => {
    const events = [...times(3, () => ev('new_street_walk', { enjoyment: 5 })), ...times(3, () => ev('brisk_walk_loop', { enjoyment: 5 }))]
    expect(ids(events).filter((i) => i.startsWith('enjoys_kind'))).toEqual([])
  })
})

describe('which kinds they enjoy', () => {
  it('notices the kind that is clearly enjoyed more, with the real numbers', () => {
    const events = [...times(3, () => ev('new_street_walk', { enjoyment: 5 })), ...times(3, () => ev('brisk_walk_loop', { enjoyment: 3 }))]
    const found = learnProfile(events).find((i) => i.id === 'enjoys_kind:exploration')!
    expect(found.text).toMatch(/exploring/i)
    expect(found.evidence).toBe('Based on 3 missions you rated, averaging 5 out of 5.')
    expect(found.strength).toBe('tentative')
  })
})

describe('times of day and days of the week', () => {
  it('finds the hard and the easy parts of the day', () => {
    const events = [
      ...times(5, (i) => at(`2026-10-0${i + 1}T19:00:00+05:30`, { outcome: 'skipped', skip_reason: 'couldnt_start' })),
      ...times(4, (i) => at(`2026-10-0${i + 1}T08:00:00+05:30`)),
    ]
    const found = learnProfile(events)
    expect(found.find((i) => i.id === 'hard_time:part:evenings')).toMatchObject({ text: 'Evenings have been harder to start.', evidence: 'You started 0 of 5 missions planned in the evenings.' })
    expect(found.find((i) => i.id === 'easy_time:part:mornings')).toMatchObject({ text: 'Starting tends to come easier in the mornings.' })
  })

  it('stays quiet about a part of the day that is mixed, or has too few answers', () => {
    const mixed = times(6, (i) => at(`2026-10-0${i + 1}T19:00:00+05:30`, i % 2 ? { outcome: 'skipped' } : {}))
    expect(ids(mixed).filter((i) => i.includes('part:'))).toEqual([])
    const few = times(3, (i) => at(`2026-10-0${i + 1}T19:00:00+05:30`, { outcome: 'skipped' }))
    expect(ids(few).filter((i) => i.includes('part:'))).toEqual([])
  })

  it('finds weekends easier than weekdays only when both have enough answers and they really differ', () => {
    const weekend = ['2026-10-10', '2026-10-11', '2026-10-17', '2026-10-18'].map((d) => at(`${d}T10:00:00+05:30`))
    const weekday = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'].map((d) => at(`${d}T10:00:00+05:30`, { outcome: 'skipped' }))
    const found = ids([...weekend, ...weekday])
    expect(found).toContain('easy_time:day:weekend')
    expect(found).toContain('hard_time:day:weekday')
    // only weekdays recorded: no contrast, so no claim
    expect(ids(weekday).filter((i) => i.includes('day:'))).toEqual([])
    // both the same
    const same = ['2026-10-10', '2026-10-11', '2026-10-17'].map((d) => at(`${d}T10:00:00+05:30`))
    const sameWeek = ['2026-10-05', '2026-10-06', '2026-10-07'].map((d) => at(`${d}T10:00:00+05:30`))
    expect(ids([...same, ...sameWeek]).filter((i) => i.includes('day:'))).toEqual([])
  })

  it('works out parts of the day and weekends from the timestamp itself, whatever the offset', () => {
    expect(partOfDay('2026-10-07T05:00:00+05:30')).toBe('mornings')
    expect(partOfDay('2026-10-07T11:59:00-08:00')).toBe('mornings')
    expect(partOfDay('2026-10-07T12:00:00+00:00')).toBe('afternoons')
    expect(partOfDay('2026-10-07T17:00:00+00:00')).toBe('evenings')
    expect(partOfDay('2026-10-07T22:00:00+00:00')).toBe('late nights')
    expect(partOfDay('2026-10-07T03:00:00+00:00')).toBe('late nights')
    expect(isWeekend('2026-10-10T23:59:00-08:00')).toBe(true)
    expect(isWeekend('2026-10-11T00:01:00+14:00')).toBe(true)
    expect(isWeekend('2026-10-12T00:01:00+14:00')).toBe(false)
  })
})

describe('durations that feel manageable', () => {
  it('notices short missions being started far more often than long ones', () => {
    const events = [
      ...times(4, () => ev('doorstep_reset', { planned_min: 5 })),
      ...times(4, () => ev('nature_trail_hike', { planned_min: 120, outcome: 'skipped' })),
    ]
    expect(learnProfile(events).find((i) => i.id === 'duration_fit:short')?.evidence).toBe('You started 4 of 4 short ones (15 minutes or less).')
  })

  it('does not claim it when long ones are fine too', () => {
    const events = [...times(4, () => ev('doorstep_reset', { planned_min: 5 })), ...times(4, () => ev('nature_trail_hike', { planned_min: 120 }))]
    expect(ids(events).filter((i) => i.startsWith('duration_fit'))).toEqual([])
  })
})

describe('what appeals', () => {
  it('novelty versus familiar routines, from ratings', () => {
    const novel = [...times(2, () => ev('new_street_walk', { enjoyment: 5 })), ...times(2, () => ev('brisk_walk_loop', { enjoyment: 3 }))]
    expect(ids(novel)).toContain('appeal:novelty')
    const familiar = [...times(2, () => ev('new_street_walk', { enjoyment: 2 })), ...times(2, () => ev('brisk_walk_loop', { enjoyment: 5 }))]
    expect(ids(familiar)).toContain('appeal:familiar')
  })

  it('company versus solitude, from who they were with', () => {
    const company = [...times(2, () => ev('walk_and_talk', { enjoyment: 5, social_mode: 'with_friend' })), ...times(2, () => ev('brisk_walk_loop', { enjoyment: 3, social_mode: 'solo' }))]
    expect(ids(company)).toContain('appeal:company')
    const solo = [...times(2, () => ev('walk_and_talk', { enjoyment: 2, social_mode: 'with_friend' })), ...times(2, () => ev('brisk_walk_loop', { enjoyment: 5, social_mode: 'solo' }))]
    expect(ids(solo)).toContain('appeal:solitude')
  })

  it('noticing things, from the helper they chose (needs two)', () => {
    expect(ids([ev('new_street_walk', { helper: 'noticing_things' })])).not.toContain('appeal:observation')
    const two = [ev('new_street_walk', { helper: 'noticing_things' }), ev('park_sit_and_watch', { helper: 'noticing_things' })]
    expect(learnProfile(two).find((i) => i.id === 'appeal:observation')?.evidence).toBe('You said noticing things made 2 missions easier.')
  })

  it('moving versus watching, from ratings', () => {
    const events = [...times(2, () => ev('easy_jog', { enjoyment: 5 })), ...times(2, () => ev('park_sit_and_watch', { enjoyment: 3 }))]
    expect(ids(events)).toContain('appeal:movement')
  })
})

describe('how they feel afterwards', () => {
  it('notices feeling calmer after missions (needs two, and at least half)', () => {
    const calm = [ev('park_sit_and_watch', { feeling: 'calmer' }), ev('quiet_reset', { feeling: 'calmer' }), ev('brisk_walk_loop', { feeling: 'same' })]
    expect(learnProfile(calm).find((i) => i.id === 'calming:calmer')?.evidence).toBe('You felt calmer after 2 of 3 missions where you said how you felt.')
    const rare = [ev('park_sit_and_watch', { feeling: 'calmer' }), ...times(3, () => ev('brisk_walk_loop', { feeling: 'same' }))]
    expect(ids(rare)).not.toContain('calming:calmer')
  })

  it('notices feeling more energetic', () => {
    expect(ids([ev('easy_jog', { feeling: 'more_energetic' }), ev('stair_climb', { feeling: 'more_energetic' })])).toContain('appeal:energising')
  })

  it('notices an activity that does not change how they feel, without calling it a failure', () => {
    const found = learnProfile([ev('brisk_walk_loop', { feeling: 'same' }), ev('brisk_walk_loop', { feeling: 'same' })]).find((i) => i.kind === 'no_change')!
    expect(found.text).toMatch(/does not seem to change how you feel/)
    expect(found.text).not.toMatch(/fail|bad|wrong/i)
  })
})

describe('repetition and repeated skips', () => {
  it('flags a mission that may be getting repetitive (done 3+ times and they would not repeat it, or ratings slipped)', () => {
    const said = [...times(3, () => ev('brisk_walk_loop', { enjoyment: 4 })), ev('brisk_walk_loop', { enjoyment: 4, would_repeat: 'no' })]
    expect(ids(said)).toContain('repetitive:brisk_walk_loop')
    const slipped = [ev('brisk_walk_loop', { enjoyment: 5 }), ev('brisk_walk_loop', { enjoyment: 4 }), ev('brisk_walk_loop', { enjoyment: 3 })]
    expect(ids(slipped)).toContain('repetitive:brisk_walk_loop')
    const fine = times(4, () => ev('brisk_walk_loop', { enjoyment: 4, would_repeat: 'yes' }))
    expect(ids(fine)).not.toContain('repetitive:brisk_walk_loop')
  })

  it('flags an activity skipped or swapped repeatedly, and one they said they would rather not repeat', () => {
    const skipped = [ev('easy_jog', { outcome: 'skipped' }), ev('easy_jog', { outcome: 'changed' }), ev('easy_jog', { outcome: 'skipped' })]
    expect(ids(skipped)).toContain('skipped_often:easy_jog')
    const never = [ev('easy_jog', { enjoyment: 3, would_repeat: 'no' })]
    expect(learnProfile(never).find((i) => i.id === 'skipped_often:easy_jog')?.text).toBe('You said you would rather not do Easy jog at a conversational pace again.')
  })
})

describe('controls', () => {
  it('"start again" ignores everything answered before the reset, and learns from what comes after', () => {
    const old = times(5, (i) => at(`2026-10-0${i + 1}T19:00:00+05:30`, { outcome: 'skipped', skip_reason: 'couldnt_start', responded_at: `2026-10-0${i + 1}T14:00:00Z` }))
    expect(ids(old)).toContain('hard_time:part:evenings')
    expect(ids(old, { reset_at: '2026-10-06T00:00:00Z' })).toEqual([])
    const newer = times(2, (i) => at(`2026-10-1${i}T19:00:00+05:30`, { outcome: 'skipped', skip_reason: 'couldnt_start', responded_at: `2026-10-1${i}T14:00:00Z` }))
    expect(ids([...old, ...newer], { reset_at: '2026-10-06T00:00:00Z' })).toContain('barrier:couldnt_start')
  })

  it('usableSignals drops what the person dismissed, and strips the evidence down to what the engine needs', () => {
    const items = learnProfile([ev('easy_jog', { outcome: 'skipped', skip_reason: 'too_far' }), ev('easy_jog', { outcome: 'skipped', skip_reason: 'too_far' })])
    expect(usableSignals(items)).toHaveLength(items.length)
    const dismissed = usableSignals(items, ['barrier:too_far'])
    expect(dismissed.find((s) => s.id === 'barrier:too_far')).toBeUndefined()
    expect(Object.keys(usableSignals(items)[0]!).sort()).toEqual(['id', 'key', 'kind', 'strength', 'text'])
  })

  it('explains what it is, how it is used, and what the person can do', () => {
    expect(LEARNING_EXPLANATION).toMatch(/guesses/)
    expect(LEARNING_EXPLANATION).toMatch(/confirm/)
    expect(LEARNING_EXPLANATION).toMatch(/start again/)
    expect(LEARNING_EXPLANATION).toMatch(/no diagnosis/i)
  })
})

describe('whatever the answers are, what it says is safe', () => {
  // A seeded sweep of random histories: the wording must never be clinical, absolute or blaming.
  function rng(seed: number) {
    let a = seed >>> 0
    return () => {
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }
  const pick = <T,>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!
  const BAD = /anxi|depress|disorder|diagnos|therap|mental|illness|lazy|fail|should|must|always|never|worthless|weak|addict/i
  // Activity titles are the catalog's own words (one says "never walked"); only the assistant's sentences are checked.
  const withoutTitles = (text: string) => ACTIVITIES.reduce((t, a) => t.split(a.title).join('<activity>'), text)

  it('has no clinical, absolute or blaming wording in any item, ever', () => {
    for (let seed = 1; seed <= 150; seed++) {
      const r = rng(seed)
      const events: LearnEvent[] = Array.from({ length: 5 + Math.floor(r() * 40) }, () => {
        const a = pick(r, ACTIVITIES)
        const outcome = pick(r, ['completed', 'completed', 'partial', 'skipped', 'changed', 'pending'] as const)
        return {
          activity_id: a.id,
          timestamp: `2026-${String(1 + Math.floor(r() * 9)).padStart(2, '0')}-${String(1 + Math.floor(r() * 27)).padStart(2, '0')}T${String(Math.floor(r() * 24)).padStart(2, '0')}:00:00+05:30`,
          outcome,
          ...(outcome === 'completed' || outcome === 'partial' ? { enjoyment: 1 + Math.floor(r() * 5), feeling: pick(r, ['calmer', 'more_energetic', 'happier', 'same', 'more_tired'] as const), would_repeat: pick(r, ['yes', 'maybe', 'no'] as const), helper: pick(r, ['clear_plan', 'company', 'noticing_things', 'kept_short'] as const), social_mode: pick(r, ['solo', 'with_friend', 'small_group'] as const) } : {}),
          ...(outcome === 'skipped' || outcome === 'changed' ? { skip_reason: pick(r, ['too_tired', 'couldnt_start', 'no_time', 'bad_weather', 'boring', 'too_far', 'other'] as const) } : {}),
          planned_min: pick(r, [5, 10, 15, 25, 45, 90]),
        }
      })
      const items = learnProfile(events)
      expect(items.length).toBeLessThanOrEqual(12)
      expect(new Set(items.map((i) => i.id)).size).toBe(items.length)
      for (const i of items) {
        expect(withoutTitles(i.text), `${i.id} (seed ${seed})`).not.toMatch(BAD)
        expect(withoutTitles(i.evidence), `${i.id} (seed ${seed})`).not.toMatch(BAD)
        expect(i.text.length).toBeGreaterThan(10)
        expect(i.samples).toBeGreaterThan(0)
        expect(['tentative', 'consistent']).toContain(i.strength)
      }
      // deterministic
      expect(learnProfile(events)).toEqual(items)
    }
  })

  it('marks a pattern consistent only with enough answers behind it', () => {
    const few = learnProfile(times(4, () => ev('easy_jog', { outcome: 'skipped', skip_reason: 'too_far' })))
    expect(few.find((i) => i.id === 'barrier:too_far')?.strength).toBe('tentative')
    const many = learnProfile(times(7, () => ev('easy_jog', { outcome: 'skipped', skip_reason: 'too_far' })))
    expect(many.find((i) => i.id === 'barrier:too_far')?.strength).toBe('consistent')
  })
})
