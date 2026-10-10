import { describe, expect, it } from 'vitest'
import { ACTIVITIES } from './engine'
import { MILESTONE_IDS, computeMeadow, creditedMinutes, formatMinutes, localDate, newMilestones, type MeadowEvent } from './meadow'
import { PROMPTS, promptKind } from './engine/companion'
import { ALL_QUESTS, QUESTS_PER_MISSION, questsFor } from './quests'

// Synthetic events only. Real activity ids so families and default durations are the engine's own.

const TODAY = '2026-10-10'
let n = 0
const ev = (activity_id: string, over: Partial<MeadowEvent> = {}): MeadowEvent => {
  n += 1
  return { activity_id, timestamp: `2026-10-0${1 + (n % 9)}T12:00:00+05:30`, outcome: 'completed', ...over }
}
/** An event on a specific local date and hour. */
const at = (date: string, hour: number, activity_id = 'brisk_walk_loop', over: Partial<MeadowEvent> = {}): MeadowEvent => ({
  activity_id,
  timestamp: `${date}T${String(hour).padStart(2, '0')}:00:00+05:30`,
  outcome: 'completed',
  ...over,
})
const earned = (events: MeadowEvent[]) => computeMeadow(events, TODAY).milestones.filter((m) => m.earned).map((m) => m.id)

describe('creditedMinutes: honest by construction', () => {
  it('counts only completed and partial missions', () => {
    for (const outcome of ['skipped', 'changed', 'pending'] as const) expect(creditedMinutes(ev('brisk_walk_loop', { outcome, minutes_outside: 40 }))).toBe(0)
  })

  it('uses the plan when there is no measurement, and half of it for "part of it"', () => {
    expect(creditedMinutes(ev('brisk_walk_loop', { planned_min: 40 }))).toBe(40)
    expect(creditedMinutes(ev('brisk_walk_loop', { planned_min: 40, outcome: 'partial' }))).toBe(20)
  })

  it('uses the measured time away when there is one', () => {
    expect(creditedMinutes(ev('brisk_walk_loop', { planned_min: 40, minutes_outside: 33 }))).toBe(33)
    expect(creditedMinutes(ev('brisk_walk_loop', { planned_min: 40, minutes_outside: 12, outcome: 'partial' }))).toBe(12)
  })

  it('cannot be inflated: a forgotten phone is capped at 1.5x the plan (at least 15 minutes)', () => {
    expect(creditedMinutes(ev('brisk_walk_loop', { planned_min: 40, minutes_outside: 480 }))).toBe(60)
    expect(creditedMinutes(ev('doorstep_reset', { planned_min: 5, minutes_outside: 300 }))).toBe(15)
  })

  it('always credits at least a minute for a real mission, and never a fraction', () => {
    expect(creditedMinutes(ev('brisk_walk_loop', { planned_min: 40, minutes_outside: 0 }))).toBe(1)
    expect(Number.isInteger(creditedMinutes(ev('brisk_walk_loop', { planned_min: 33, outcome: 'partial' })))).toBe(true)
  })

  it('falls back to the activity default for events saved before this existed, and tolerates unknown activities', () => {
    const walk = ACTIVITIES.find((a) => a.id === 'brisk_walk_loop')!
    expect(creditedMinutes(ev('brisk_walk_loop'))).toBe(walk.duration.default)
    expect(creditedMinutes(ev('no_such_activity'))).toBeGreaterThan(0)
  })
})

describe('milestones: earned once, kept forever', () => {
  it('starts with nothing, and an unanswered or skipped mission earns nothing', () => {
    expect(earned([])).toEqual([])
    expect(earned([ev('brisk_walk_loop', { outcome: 'skipped' }), ev('easy_jog', { outcome: 'pending' })])).toEqual([])
  })

  it('first step comes from the very first credited mission, with its own timestamp', () => {
    const m = computeMeadow([at('2026-10-03', 10)], TODAY).milestones.find((x) => x.id === 'first_step')!
    expect(m.earned).toBe(true)
    expect(m.earned_at).toBe('2026-10-03T10:00:00+05:30')
  })

  it('minute milestones are earned by the mission that crossed the line', () => {
    const events = [at('2026-10-01', 10, 'brisk_walk_loop', { planned_min: 30 }), at('2026-10-02', 10, 'brisk_walk_loop', { planned_min: 30 }), at('2026-10-03', 10, 'brisk_walk_loop', { planned_min: 30 })]
    const hour = computeMeadow(events, TODAY).milestones.find((x) => x.id === 'hour_out')!
    expect(hour.earned).toBe(true)
    expect(hour.earned_at).toBe('2026-10-02T10:00:00+05:30') // 30 + 30 = 60 on the second mission
  })

  it('never takes a milestone away when more is added (monotonic), whatever the new events are', () => {
    const base = [at('2026-10-01', 7), at('2026-10-02', 18), at('2026-10-03', 12, 'new_street_walk'), at('2026-10-04', 12, 'call_friend_walk')]
    const before = new Set(earned(base))
    const extras: MeadowEvent[][] = [
      [at('2026-10-05', 12, 'easy_jog', { outcome: 'skipped' })],
      [at('2026-10-05', 12, 'easy_jog', { outcome: 'pending' })],
      [at('2026-10-05', 12, 'easy_jog', { outcome: 'changed' })],
      [at('2026-10-05', 12, 'easy_jog', { minutes_outside: 1 })],
    ]
    for (const extra of extras) for (const id of before) expect(earned([...base, ...extra]), id).toContain(id)
  })

  it('does not depend on the order events arrive in', () => {
    const events = [at('2026-10-01', 7), at('2026-10-02', 18), at('2026-10-03', 12, 'new_street_walk'), at('2026-10-04', 12, 'call_friend_walk')]
    expect(earned([...events].reverse())).toEqual(earned(events))
  })

  it('a bit of everything needs a movement, an exploring and a social or skill mission', () => {
    expect(earned([at('2026-10-01', 12, 'brisk_walk_loop'), at('2026-10-02', 12, 'easy_jog')])).not.toContain('all_kinds')
    expect(earned([at('2026-10-01', 12, 'brisk_walk_loop'), at('2026-10-02', 12, 'new_street_walk'), at('2026-10-03', 12, 'call_friend_walk')])).toContain('all_kinds')
  })

  it('five different things, not the same walk five times', () => {
    const same = Array.from({ length: 6 }, (_, i) => at(`2026-10-0${i + 1}`, 12, 'brisk_walk_loop'))
    expect(earned(same)).not.toContain('variety')
    const ids = ['brisk_walk_loop', 'easy_jog', 'new_street_walk', 'call_friend_walk', 'park_sit_and_watch']
    expect(earned(ids.map((id, i) => at(`2026-10-0${i + 1}`, 12, id)))).toContain('variety')
  })

  it('early start is before 9, evening is 5 to 8 pm, and neither is triggered by the wrong hours', () => {
    expect(earned([at('2026-10-01', 4)])).not.toContain('early_start')
    expect(earned([at('2026-10-01', 5)])).toContain('early_start')
    expect(earned([at('2026-10-01', 8)])).toContain('early_start')
    expect(earned([at('2026-10-01', 9)])).not.toContain('early_start')
    expect(earned([at('2026-10-01', 16)])).not.toContain('evening_out')
    expect(earned([at('2026-10-01', 17)])).toContain('evening_out')
    expect(earned([at('2026-10-01', 19)])).toContain('evening_out')
    expect(earned([at('2026-10-01', 20)])).not.toContain('evening_out')
  })

  it('welcome back is earned by returning after a week or more, and celebrates it (no "catching up")', () => {
    expect(earned([at('2026-10-01', 12), at('2026-10-07', 12)])).not.toContain('comeback') // 6 days
    expect(earned([at('2026-10-01', 12), at('2026-10-08', 12)])).toContain('comeback') // 7 days
    const m = computeMeadow([at('2026-10-01', 12)], TODAY).milestones.find((x) => x.id === 'comeback')!
    expect(m.description).toMatch(/no catching up/i)
  })

  it('side-quest finder sums quests across missions; three great ones needs three 5/5 ratings', () => {
    const quests = Array.from({ length: 5 }, (_, i) => at(`2026-10-0${i + 1}`, 12, 'brisk_walk_loop', { quests_done: 2 }))
    expect(earned(quests)).toContain('quester')
    expect(earned(quests.slice(0, 4))).not.toContain('quester')
    const loved = [5, 5, 4, 5].map((enjoyment, i) => at(`2026-10-0${i + 1}`, 12, 'brisk_walk_loop', { enjoyment }))
    expect(earned(loved)).toContain('loved_it')
    expect(earned(loved.slice(0, 3))).not.toContain('loved_it')
  })

  it('every milestone can be earned by some history (none are impossible)', () => {
    const rich: MeadowEvent[] = []
    const ids = ['brisk_walk_loop', 'easy_jog', 'new_street_walk', 'call_friend_walk', 'park_sit_and_watch', 'waterfront_walk']
    for (let i = 0; i < 60; i++) {
      const day = 1 + (i % 28)
      const date = `2026-0${1 + Math.floor(i / 28) * 3}-${String(day).padStart(2, '0')}`
      rich.push(at(date, i % 2 ? 7 : 18, ids[i % ids.length], { planned_min: 45, minutes_outside: 45, enjoyment: 5, quests_done: 2, has_note: i % 5 === 0, social_mode: i % 4 === 0 ? 'with_friend' : 'solo' }))
    }
    for (let i = 0; i < 4; i++) rich.push(at(`2026-0${2 + i}-0${3 + i}`, 12, 'easy_jog', { outcome: i % 2 ? 'changed' : 'skipped' }))
    expect(earned(rich).sort()).toEqual([...MILESTONE_IDS].sort())
  })

  it('has progress for numeric milestones that is never beyond the target', () => {
    const summary = computeMeadow([at('2026-10-01', 12, 'brisk_walk_loop', { planned_min: 500, minutes_outside: 700 })], TODAY)
    for (const m of summary.milestones) if (m.progress) expect(m.progress.current).toBeLessThanOrEqual(m.progress.target)
  })
})

describe('newMilestones: what one mission just earned', () => {
  it('lists only milestones that were not already earned', () => {
    const before = [at('2026-10-01', 12, 'brisk_walk_loop', { planned_min: 30 })]
    const after = [...before, at('2026-10-02', 12, 'brisk_walk_loop', { planned_min: 30 })]
    expect(newMilestones([], before).map((m) => m.id)).toEqual(['first_step'])
    expect(newMilestones(before, after).map((m) => m.id)).toEqual(['hour_out'])
    expect(newMilestones(after, after)).toEqual([])
  })

  it('earns nothing for a skip', () => {
    const before = [at('2026-10-01', 12)]
    expect(newMilestones(before, [...before, at('2026-10-02', 12, 'easy_jog', { outcome: 'skipped' })])).toEqual([])
  })
})

describe('computeMeadow', () => {
  it('totals only real, credited time and missions', () => {
    const s = computeMeadow(
      [at('2026-10-08', 12, 'brisk_walk_loop', { planned_min: 30 }), at('2026-10-09', 12, 'easy_jog', { outcome: 'skipped' }), at('2026-10-09', 13, 'new_street_walk', { planned_min: 40, outcome: 'partial' })],
      TODAY,
    )
    expect(s.total_minutes).toBe(30 + 20)
    expect(s.missions).toBe(2)
    expect(s.minutes_by_family).toEqual({ movement: 30, exploration: 20, social_skill: 0 })
  })

  it('has exactly seven days ending today, with minutes on the right days', () => {
    const s = computeMeadow([at('2026-10-10', 9, 'brisk_walk_loop', { planned_min: 25 }), at('2026-10-04', 9, 'brisk_walk_loop', { planned_min: 15 }), at('2026-10-03', 9, 'brisk_walk_loop', { planned_min: 99 })], TODAY)
    expect(s.week.days.map((d) => d.date)).toEqual(['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'])
    expect(s.week.days[0]!.minutes).toBe(15)
    expect(s.week.days[6]!.minutes).toBe(25)
    expect(s.week.minutes).toBe(40)
    expect(s.week.last_week_minutes).toBe(Math.min(99, 150)) // 2026-10-03 is in the week before
  })

  it('next is the unearned milestone you are closest to, and null when everything is earned or nothing has progress', () => {
    expect(computeMeadow([], TODAY).next?.id).toBeTruthy()
    const s = computeMeadow([at('2026-10-01', 12, 'brisk_walk_loop', { planned_min: 45 })], TODAY)
    expect(s.next?.id).toBe('hour_out') // 45 of 60 minutes is the closest
    expect(s.next?.earned).toBe(false)
  })

  it('draws one flower per credited mission by kind, oldest first, capped', () => {
    const events = Array.from({ length: 75 }, (_, i) => at(`2026-${String(1 + (i % 9)).padStart(2, '0')}-10`, 12 - (i % 3), 'brisk_walk_loop'))
    expect(computeMeadow(events, TODAY).flowers).toHaveLength(60)
    expect(computeMeadow([at('2026-10-01', 12, 'brisk_walk_loop'), at('2026-10-02', 12, 'new_street_walk')], TODAY).flowers).toEqual(['movement', 'exploration'])
  })

  it('names a favourite only after at least two of the same', () => {
    expect(computeMeadow([at('2026-10-01', 12)], TODAY).favourite).toBeNull()
    const s = computeMeadow([at('2026-10-01', 12), at('2026-10-02', 12)], TODAY)
    expect(s.favourite).toMatchObject({ activity_id: 'brisk_walk_loop', count: 2 })
  })

  it('an empty meadow is a calm starting point, not an error', () => {
    const s = computeMeadow([], TODAY)
    expect(s.total_minutes).toBe(0)
    expect(s.flowers).toEqual([])
    expect(s.week.days).toHaveLength(7)
  })
})

describe('helpers', () => {
  it('formats minutes plainly', () => {
    expect(formatMinutes(0)).toBe('0 min')
    expect(formatMinutes(45)).toBe('45 min')
    expect(formatMinutes(60)).toBe('1 h')
    expect(formatMinutes(80)).toBe('1 h 20 min')
    expect(formatMinutes(-5)).toBe('0 min')
  })

  it('finds the local calendar date for an offset', () => {
    const t = new Date('2026-10-10T20:00:00Z')
    expect(localDate(t, 330)).toBe('2026-10-11') // India is already tomorrow
    expect(localDate(t, -300)).toBe('2026-10-10')
  })
})

describe('the prompt for while out (one, activity-specific, optional)', () => {
  const mission = (i: number) => `r_00000000-0000-4000-8000-${String(i).padStart(12, '0')}`

  it('gives exactly one prompt, the same one every time for the same mission (works after a reload or offline)', () => {
    expect(questsFor('brisk_walk_loop', mission(1))).toHaveLength(QUESTS_PER_MISSION)
    expect(QUESTS_PER_MISSION).toBe(1)
    expect(questsFor('brisk_walk_loop', mission(1))).toEqual(questsFor('brisk_walk_loop', mission(1)))
  })

  it("is in the style of the activity: walking, exploring, social and calm each get their own kind of prompt", () => {
    expect(PROMPTS.walk).toContain(questsFor('brisk_walk_loop', mission(7))[0])
    expect(PROMPTS.explore).toContain(questsFor('new_street_walk', mission(7))[0])
    expect(PROMPTS.social).toContain(questsFor('walk_and_talk', mission(7))[0])
    expect(PROMPTS.calm).toContain(questsFor('quiet_reset', mission(7))[0])
    expect(PROMPTS.creative).toContain(questsFor('outdoor_sketching', mission(7))[0])
  })

  it("uses the document's own examples as the first prompt of each of its four kinds", () => {
    expect(PROMPTS.walk[0]).toBe("Notice one thing along your route that you haven't paid attention to before.")
    expect(PROMPTS.explore[0]).toBe('Find an interesting detail in your surroundings.')
    expect(PROMPTS.social[0]).toBe("Ask someone a question you wouldn't normally ask, if that feels comfortable.")
    expect(PROMPTS.calm[0]).toBe('Notice three things you can see or hear.')
  })

  it('every activity has a kind, and every kind has three prompts', () => {
    for (const a of ACTIVITIES) expect(PROMPTS[promptKind(a.id)], a.id).toHaveLength(3)
    for (const [kind, bank] of Object.entries(PROMPTS)) expect(new Set(bank).size, kind).toBe(3)
  })

  it('varies between missions, so it does not feel repeated', () => {
    const seen = new Set(Array.from({ length: 100 }, (_, i) => questsFor('brisk_walk_loop', mission(i))[0]))
    expect(seen.size).toBe(3)
  })

  it('copes with an unknown activity', () => {
    expect(questsFor('no_such_activity', mission(1))).toHaveLength(1)
  })

  it('is safe: short, plain, no links, no money, nothing risky, nobody forced', () => {
    for (const q of ALL_QUESTS) {
      expect(q.length, q).toBeLessThan(120)
      expect(q, q).not.toMatch(/https?:|www\.|\$|buy|pay |stranger|climb|swim|cross the road|trespass|must|have to/i)
    }
    expect(ALL_QUESTS).toHaveLength(24)
  })
})

describe('the memory garden', () => {
  it('honest check-ins are recognised, add no time, and never count as missions', () => {
    const events = [at('2026-10-01', 12, 'brisk_walk_loop', { planned_min: 30, minutes_outside: 30 }), at('2026-10-02', 12, 'easy_jog', { outcome: 'skipped' }), at('2026-10-03', 12, 'easy_jog', { outcome: 'changed' })]
    const s = computeMeadow(events, TODAY)
    expect(s.garden.seeds).toBe(2)
    expect(s.total_minutes).toBe(30)
    expect(s.missions).toBe(1)
    expect(s.milestones.find((m) => m.id === 'honest_checkins')!.earned).toBe(false)
    expect(s.milestones.find((m) => m.id === 'honest_checkins')!.progress).toEqual({ current: 2, target: 3 })
  })

  it('earns the honest-check-ins milestone on the third honest answer, with that answer\'s moment', () => {
    const events = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'].map((d) => at(d, 9, 'easy_jog', { outcome: 'skipped' }))
    const m = computeMeadow(events, TODAY).milestones.find((x) => x.id === 'honest_checkins')!
    expect(m.earned).toBe(true)
    expect(m.earned_at).toBe('2026-10-03T09:00:00+05:30')
  })

  it('does not count unanswered missions as honest check-ins', () => {
    expect(computeMeadow([at('2026-10-01', 9, 'easy_jog', { outcome: 'pending' })], TODAY).garden.seeds).toBe(0)
  })

  it('keeps a keepsake for each mission with a note or a photo (only for missions that happened)', () => {
    const s = computeMeadow(
      [at('2026-10-01', 12, 'brisk_walk_loop', { has_note: true }), at('2026-10-02', 12, 'brisk_walk_loop', { has_photo: true }), at('2026-10-03', 12, 'brisk_walk_loop'), at('2026-10-04', 12, 'easy_jog', { outcome: 'skipped', has_note: true })],
      TODAY,
    )
    expect(s.garden.keepsakes).toBe(2)
    expect(s.milestones.find((m) => m.id === 'memory_keeper')!.earned_at).toBe('2026-10-01T12:00:00+05:30')
  })

  it('gives a token for missions done with other people, not for solo ones or ones that did not happen', () => {
    const s = computeMeadow(
      [at('2026-10-01', 12, 'walk_and_talk', { social_mode: 'with_friend' }), at('2026-10-02', 12, 'cards_outside', { social_mode: 'small_group' }), at('2026-10-03', 12, 'brisk_walk_loop', { social_mode: 'solo' }), at('2026-10-04', 12, 'walk_and_talk', { social_mode: 'with_friend', outcome: 'skipped' })],
      TODAY,
    )
    expect(s.garden.social_tokens).toBe(2)
    expect(s.milestones.find((m) => m.id === 'connected')!.earned).toBe(true)
  })

  it('grows a tree only for something done three times and rated well (rated at least twice, averaging 4 or more)', () => {
    const tree = (ratings: (number | undefined)[]) =>
      computeMeadow(ratings.map((enjoyment, i) => at(`2026-10-0${i + 1}`, 12, 'brisk_walk_loop', enjoyment === undefined ? {} : { enjoyment })), TODAY).garden.trees.map((t) => t.activity_id)
    expect(tree([5, 4, 5])).toEqual(['brisk_walk_loop'])
    expect(tree([5, 4])).toEqual([]) // only twice
    expect(tree([5, undefined, undefined])).toEqual([]) // one rating is not enough
    expect(tree([4, 3, 3])).toEqual([]) // average 3.3
    const m = computeMeadow([5, 4, 5].map((enjoyment, i) => at(`2026-10-0${i + 1}`, 12, 'brisk_walk_loop', { enjoyment })), TODAY).milestones.find((x) => x.id === 'grown_to_enjoy')!
    expect(m.earned_at).toBe('2026-10-03T12:00:00+05:30')
    expect(computeMeadow([5, 4, 5].map((enjoyment, i) => at(`2026-10-0${i + 1}`, 12, 'brisk_walk_loop', { enjoyment })), TODAY).garden.trees[0]).toMatchObject({ title: 'Brisk walk, one familiar loop', family: 'movement' })
  })

  it('carries the lessons the person confirmed (never negative)', () => {
    expect(computeMeadow([], TODAY, 3).garden.lessons).toBe(3)
    expect(computeMeadow([], TODAY, -2).garden.lessons).toBe(0)
    expect(computeMeadow([], TODAY).garden.lessons).toBe(0)
  })

  it('an empty garden is just an empty garden', () => {
    expect(computeMeadow([], TODAY).garden).toEqual({ trees: [], keepsakes: 0, social_tokens: 0, seeds: 0, lessons: 0 })
  })

  it('never loses anything when more is added (the garden only grows)', () => {
    const base = [at('2026-10-01', 12, 'brisk_walk_loop', { enjoyment: 5, has_note: true, social_mode: 'with_friend' }), at('2026-10-02', 12, 'easy_jog', { outcome: 'skipped' })]
    const before = computeMeadow(base, TODAY).garden
    for (const extra of [at('2026-10-03', 12, 'easy_jog', { outcome: 'skipped' }), at('2026-10-03', 12, 'easy_jog', { outcome: 'pending' }), at('2026-10-03', 12, 'brisk_walk_loop', { minutes_outside: 1 })]) {
      const after = computeMeadow([...base, extra], TODAY).garden
      expect(after.keepsakes).toBeGreaterThanOrEqual(before.keepsakes)
      expect(after.social_tokens).toBeGreaterThanOrEqual(before.social_tokens)
      expect(after.seeds).toBeGreaterThanOrEqual(before.seeds)
    }
  })
})
