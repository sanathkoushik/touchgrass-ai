import { describe, expect, it } from 'vitest'
import { MILESTONE_IDS, computeMeadow, type MeadowEvent } from '@/shared/meadow'
import { celebrationHeadline, earnedOn, remainingText, weekdayShort } from './meadow-text'

const at = (date: string, minutes: number): MeadowEvent => ({ activity_id: 'brisk_walk_loop', timestamp: `${date}T12:00:00+05:30`, outcome: 'completed', planned_min: minutes, minutes_outside: minutes })

describe('remainingText', () => {
  it('says how far a milestone is, in its own unit', () => {
    const s = computeMeadow([at('2026-10-01', 20)], '2026-10-10')
    const hour = s.milestones.find((m) => m.id === 'hour_out')!
    expect(remainingText(hour)).toBe('40 min to go')
    const ten = s.milestones.find((m) => m.id === 'ten_missions')!
    expect(remainingText(ten)).toBe('9 more missions to go')
  })

  it('uses the singular for one left', () => {
    const events = Array.from({ length: 9 }, (_, i) => at(`2026-10-0${i + 1}`, 5))
    const ten = computeMeadow(events, '2026-10-10').milestones.find((m) => m.id === 'ten_missions')!
    expect(remainingText(ten)).toBe('1 more mission to go')
  })

  it('says nothing for earned milestones, or ones with no target', () => {
    const s = computeMeadow([at('2026-10-01', 70)], '2026-10-10')
    expect(remainingText(s.milestones.find((m) => m.id === 'hour_out')!)).toBeNull()
    expect(remainingText(s.milestones.find((m) => m.id === 'comeback')!)).toBeNull()
  })

  it('has wording for every numeric milestone (none can be silently skipped)', () => {
    const s = computeMeadow([], '2026-10-10')
    for (const id of MILESTONE_IDS) {
      const m = s.milestones.find((x) => x.id === id)!
      if (m.progress) expect(remainingText(m), id).toMatch(/ to go$/)
    }
  })
})

describe('celebrationHeadline', () => {
  it('is warm and specific, and never compares or scolds', () => {
    expect(celebrationHeadline('completed', null)).toBe('That was real. Nicely done.')
    expect(celebrationHeadline('completed', 5)).toMatch(/loved/i)
    expect(celebrationHeadline('partial', 5)).toBe('Part of it still counts.')
    for (const h of [celebrationHeadline('completed', 3), celebrationHeadline('partial', null)]) expect(h).not.toMatch(/only|just|less|fail|should|better than/i)
  })
})

describe('dates', () => {
  it('shows weekday and day from the calendar date itself, in any time zone', () => {
    expect(weekdayShort('2026-10-07')).toBe('Wed')
    expect(weekdayShort('2026-10-11')).toBe('Sun')
    expect(earnedOn('2026-10-07T17:42:00+05:30')).toBe('Oct 7')
    expect(earnedOn('2026-01-01T00:05:00-08:00')).toBe('Jan 1')
    expect(earnedOn('garbage')).toBe('')
  })
})

import { awayText } from './away'

describe('awayText', () => {
  it('says how long ago they set off, plainly', () => {
    expect(awayText(null)).toBeNull()
    expect(awayText(0)).toBe('You just set off.')
    expect(awayText(1)).toBe('You set off 1 minute ago.')
    expect(awayText(41)).toBe('You set off 41 minutes ago.')
    expect(awayText(60)).toBe('You set off 1 hour ago.')
    expect(awayText(65)).toBe('You set off 1 hour 5 minutes ago.')
    expect(awayText(125)).toBe('You set off 2 hours 5 minutes ago.')
  })
})
