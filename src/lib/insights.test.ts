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
