import { describe, expect, it } from 'vitest'
import type { HistoryItem } from '@/shared/api'
import { summarizeLearning } from './insights'

let n = 0
const item = (activity_id: string, outcome: HistoryItem['outcome'], hour: number, extra: Partial<HistoryItem> = {}): HistoryItem => {
  n += 1
  return {
    recommendation_id: `r_${n}`,
    timestamp: `2026-09-${String(1 + (n % 27)).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00+05:30`,
    activity_id,
    title: activity_id.replace(/_/g, ' '),
    outcome,
    enjoyment: null,
    skip_reason: null,
    ...extra,
  }
}
const times = (k: number, make: () => HistoryItem) => Array.from({ length: k }, make)

describe('summarizeLearning', () => {
  it('says nothing without enough real data', () => {
    expect(summarizeLearning([])).toEqual([])
    expect(summarizeLearning([item('brisk_walk_loop', 'completed', 18), item('easy_jog', 'skipped', 18)])).toEqual([])
  })

  it('ignores unanswered missions entirely', () => {
    expect(summarizeLearning(times(10, () => item('brisk_walk_loop', 'pending', 18)))).toEqual([])
  })

  it('names the part of the day that works best, with the real counts', () => {
    const items = [
      ...times(4, () => item('brisk_walk_loop', 'completed', 18)),
      item('brisk_walk_loop', 'skipped', 18),
      ...times(3, () => item('brisk_walk_loop', 'skipped', 7)),
    ]
    const lines = summarizeLearning(items)
    expect(lines).toContain('Evenings work best for you: you did 4 of 5.')
  })

  it('does not name a winner when parts of the day tie', () => {
    const items = [...times(3, () => item('brisk_walk_loop', 'completed', 18)), ...times(3, () => item('brisk_walk_loop', 'completed', 7))]
    expect(summarizeLearning(items).join(' ')).not.toMatch(/work best/)
  })

  it('treats the small hours as part of the night, not the morning', () => {
    const items = times(3, () => item('brisk_walk_loop', 'completed', 1))
    expect(summarizeLearning(items).join(' ')).toMatch(/Late nights work best for you: you did 3 of 3/)
  })

  it('does not call a part of the day "best" when most missions there did not happen', () => {
    const items = [item('a', 'completed', 18), ...times(3, () => item('brisk_walk_loop', 'skipped', 18))]
    expect(summarizeLearning(items).join(' ')).not.toMatch(/work best/)
  })

  it('names the kind of activity followed through most', () => {
    const items = [
      ...times(3, () => item('brisk_walk_loop', 'completed', 18)), // movement
      ...times(3, () => item('new_street_walk', 'skipped', 18)), // exploration
    ]
    expect(summarizeLearning(items).join('\n')).toContain('You follow through most on movement: 3 of 3.')
  })

  it('reports the most common recorded reason only when it repeats', () => {
    const once = [item('easy_jog', 'skipped', 18, { skip_reason: 'too_tired' })]
    expect(summarizeLearning(once).join(' ')).not.toMatch(/gets in the way/)
    const repeated = [...once, item('easy_jog', 'skipped', 18, { skip_reason: 'too_tired' }), item('easy_jog', 'skipped', 18, { skip_reason: 'no_time' })]
    expect(summarizeLearning(repeated).join(' ')).toContain('What gets in the way most: too tired (2 times).')
  })

  it('breaks ties between skip reasons deterministically', () => {
    const items = [
      item('a', 'skipped', 18, { skip_reason: 'no_time' }),
      item('a', 'skipped', 18, { skip_reason: 'no_time' }),
      item('a', 'skipped', 18, { skip_reason: 'boring' }),
      item('a', 'skipped', 18, { skip_reason: 'boring' }),
    ]
    expect(summarizeLearning(items).join(' ')).toContain('not exciting (2 times)')
  })

  it('names a favourite only with two ratings averaging 4 or more', () => {
    const one = [item('brisk_walk_loop', 'completed', 18, { enjoyment: 5 })]
    expect(summarizeLearning(one).join(' ')).not.toMatch(/rate/)
    const low = [item('brisk_walk_loop', 'completed', 18, { enjoyment: 2 }), item('brisk_walk_loop', 'completed', 18, { enjoyment: 3 })]
    expect(summarizeLearning(low).join(' ')).not.toMatch(/rate/)
    const good = [item('brisk_walk_loop', 'completed', 18, { enjoyment: 5 }), item('brisk_walk_loop', 'completed', 18, { enjoyment: 4 })]
    expect(summarizeLearning(good).join(' ')).toContain('You rate "brisk walk loop" highest: 4.5 out of 5 over 2 times.')
  })

  it('never uses guilt words', () => {
    const items = times(8, () => item('easy_jog', 'skipped', 18, { skip_reason: 'too_tired' }))
    expect(summarizeLearning(items).join(' ')).not.toMatch(/fail|lazy|should|streak|bad/i)
  })
})

import { tastesOverTime } from './insights'

describe('tastesOverTime: how preferences have moved', () => {
  const m = (activity_id: string, date: string, hour: number, outcome: HistoryItem['outcome'] = 'completed'): HistoryItem => ({
    recommendation_id: `r_${date}${hour}${activity_id}`,
    timestamp: `${date}T${String(hour).padStart(2, '0')}:00:00+05:30`,
    activity_id,
    title: activity_id,
    outcome,
    enjoyment: null,
    skip_reason: null,
  })

  it('says nothing until there are enough missions that happened (nine, three per third)', () => {
    expect(tastesOverTime([])).toBeNull()
    const eight = Array.from({ length: 8 }, (_, i) => m('brisk_walk_loop', `2026-09-0${i + 1}`, 8))
    expect(tastesOverTime(eight)).toBeNull()
    const skipped = Array.from({ length: 12 }, (_, i) => m('brisk_walk_loop', `2026-09-${String(i + 1).padStart(2, '0')}`, 8, 'skipped'))
    expect(tastesOverTime(skipped)).toBeNull() // missions that did not happen are not "tastes"
  })

  it('shows a shift in the kind of mission and the time of day', () => {
    const early = ['01', '02', '03'].map((d) => m('brisk_walk_loop', `2026-09-${d}`, 7)) // movement, mornings
    const mid = ['10', '11', '12'].map((d) => m('easy_jog', `2026-09-${d}`, 7))
    const recent = ['20', '21', '22'].map((d) => m('new_street_walk', `2026-09-${d}`, 18)) // exploring, evenings
    const t = tastesOverTime([...recent, ...mid, ...early])! // order must not matter
    expect(t.changed).toBe(true)
    expect(t.early).toMatchObject({ family: 'movement', part: 'mornings', n: 3 })
    expect(t.recent).toMatchObject({ family: 'exploration', part: 'evenings', n: 3 })
    expect(t.lines).toEqual(['Early on you mostly did movement missions. Lately it has been exploring.', 'You used to go out mostly in the mornings. Lately it has been the evenings.'])
  })

  it('says when nothing has changed, without making it sound like a problem', () => {
    const steady = Array.from({ length: 9 }, (_, i) => m('brisk_walk_loop', `2026-09-0${i + 1}`, 8))
    const t = tastesOverTime(steady)!
    expect(t.changed).toBe(false)
    expect(t.lines).toEqual(['Your choices have stayed steady: mostly movement, in the mornings.'])
  })

  it('never uses a label or a verdict', () => {
    const items = [...Array.from({ length: 4 }, (_, i) => m('brisk_walk_loop', `2026-09-0${i + 1}`, 7)), ...Array.from({ length: 5 }, (_, i) => m('new_street_walk', `2026-09-1${i}`, 19))]
    for (const l of tastesOverTime(items)!.lines) expect(l).not.toMatch(/type of person|you are a|always|never|should|lazy|better|worse/i)
  })
})
