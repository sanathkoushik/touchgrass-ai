import { describe, expect, it } from 'vitest'
import { SUPPORT_LABEL, evidenceFor, evidenceTypeOf, participationOf, supportLevel, toMissionRecord, type MissionRecordSource } from './mission-record'
import { computeValueMetrics, describeMetrics, type MetricEvent } from './metrics'

const source = (over: Partial<MissionRecordSource & { skip_reason?: 'too_tired' }> = {}): MissionRecordSource & { skip_reason?: 'too_tired' } => ({
  recommendation_id: 'r_00000000-0000-4000-8000-000000000001',
  activity_id: 'quiet_reset',
  timestamp: '2026-10-07T17:42:00+05:30',
  outcome: 'completed',
  context: { duration_limit: 15, mood: 'low', planned_min: 15, desired_outcome: 'clear_head', created_at: '2026-10-07T12:11:00.000Z' },
  ...over,
})

describe('participation is what the person said, nothing else', () => {
  it('maps outcomes to full, partial, not started or something else', () => {
    expect(participationOf('completed')).toBe('full')
    expect(participationOf('partial')).toBe('partial')
    expect(participationOf('skipped')).toBe('not_started')
    expect(participationOf('changed')).toBe('something_else')
    expect(participationOf('pending')).toBeNull()
  })

  it('is never changed by evidence: the same answer is the same status with or without supporting signals', () => {
    const bare = toMissionRecord(source())
    const rich = toMissionRecord(source({ minutes_outside: 15, reflection: { minutes_source: 'measured', has_photo: true, note: 'x', feeling: 'calmer' } }))
    const contradicting = toMissionRecord(source({ minutes_outside: 1, reflection: { minutes_source: 'measured' } })) // far less time than planned
    expect(bare.participation_status).toBe('full')
    expect(rich.participation_status).toBe('full')
    expect(contradicting.participation_status).toBe('full') // we never override or accuse
  })
})

describe('evidence supports; it never proves or punishes', () => {
  it('has none for a plain self-report, and for missions that did not happen', () => {
    expect(evidenceFor(source())).toEqual([])
    expect(evidenceFor(source({ outcome: 'skipped', minutes_outside: 20, reflection: { has_photo: true, note: 'x', minutes_source: 'measured' } }))).toEqual([])
    expect(evidenceFor(source({ outcome: 'pending' }))).toEqual([])
  })

  it('counts elapsed time only when the app measured it and it is plausible for the plan', () => {
    expect(evidenceFor(source({ minutes_outside: 15, reflection: { minutes_source: 'measured' } }))).toEqual(['elapsed_time'])
    expect(evidenceFor(source({ minutes_outside: 6, reflection: { minutes_source: 'measured' } }))).toEqual(['elapsed_time']) // 40% of 15 is exactly 6
    expect(evidenceFor(source({ minutes_outside: 5, reflection: { minutes_source: 'measured' } }))).toEqual([]) // too short to support
    expect(evidenceFor(source({ minutes_outside: 15, reflection: { minutes_source: 'stated' } }))).toEqual([]) // typed in, not measured
    expect(evidenceFor(source({ minutes_outside: 15 }))).toEqual([])
  })

  it('counts a photo and a reflection, but not an empty one', () => {
    expect(evidenceFor(source({ reflection: { has_photo: true } }))).toEqual(['photo'])
    expect(evidenceFor(source({ reflection: { feeling: 'calmer' } }))).toEqual(['reflection'])
    expect(evidenceFor(source({ reflection: { note: 'I noticed the birds.' } }))).toEqual(['reflection'])
    expect(evidenceFor(source({ reflection: { note: '   ' } }))).toEqual([])
    expect(evidenceFor(source({ reflection: {} }))).toEqual([])
  })

  it('names the strongest signal as the record\'s evidence type, and the level as self-reported, supported or reflected', () => {
    expect(evidenceTypeOf([])).toBe('none')
    expect(evidenceTypeOf(['elapsed_time'])).toBe('elapsed_time')
    expect(evidenceTypeOf(['elapsed_time', 'photo'])).toBe('photo')
    expect(evidenceTypeOf(['reflection'])).toBe('other')
    expect(supportLevel([])).toBe('self_reported')
    expect(supportLevel(['elapsed_time'])).toBe('supported')
    expect(supportLevel(['photo'])).toBe('supported')
    expect(supportLevel(['elapsed_time', 'reflection'])).toBe('reflected')
  })

  it('has labels that describe context and never suggest distrust', () => {
    for (const label of Object.values(SUPPORT_LABEL)) expect(label).not.toMatch(/unverified|fake|cheat|suspicious|proof|invalid/i)
  })
})

describe('toMissionRecord has exactly the document\'s fields', () => {
  it('maps a full record', () => {
    const r = toMissionRecord(
      source({
        started_at: '2026-10-07T12:00:00.000Z',
        responded_at: '2026-10-07T12:20:00.000Z',
        minutes_outside: 15,
        reflection: { feeling: 'calmer', barrier: 'too_tired', would_repeat: 'yes', note: '  Sitting felt easier today.  ', minutes_source: 'measured' },
      }),
    )
    expect(r).toEqual({
      mission_id: 'r_00000000-0000-4000-8000-000000000001',
      activity_type: 'quiet_reset',
      recommended_duration: 15,
      user_selected_duration: 15,
      mission_started_at: '2026-10-07T12:00:00.000Z',
      mission_returned_at: '2026-10-07T12:20:00.000Z',
      participation_status: 'full',
      evidence_type: 'elapsed_time',
      pre_activity_energy: 'low',
      desired_outcome: 'clear_head',
      post_activity_feeling: 'calmer',
      difficulty_or_barrier: 'too_tired',
      would_repeat: 'yes',
      optional_reflection: 'Sitting felt easier today.',
      created_at: '2026-10-07T12:11:00.000Z',
    })
  })

  it('uses null (not a made-up value) for anything unknown', () => {
    const r = toMissionRecord({ ...source(), context: { duration_limit: 30, mood: 'ok' } })
    expect(r).toMatchObject({ recommended_duration: null, mission_started_at: null, mission_returned_at: null, desired_outcome: null, post_activity_feeling: null, difficulty_or_barrier: null, would_repeat: null, optional_reflection: null, evidence_type: 'none' })
    expect(r.created_at).toBe('2026-10-07T17:42:00+05:30') // falls back to the mission's own time
  })

  it('takes the barrier from the skip reason for a mission that did not start', () => {
    const r = toMissionRecord(source({ outcome: 'skipped', skip_reason: 'too_tired' }))
    expect(r.difficulty_or_barrier).toBe('too_tired')
    expect(r.participation_status).toBe('not_started')
    expect(r.evidence_type).toBe('none')
  })
})

describe('value metrics (real-world value, not app time)', () => {
  let n = 0
  const ev = (outcome: MetricEvent['outcome'], date: string, over: Partial<MetricEvent> = {}): MetricEvent => {
    n += 1
    return { activity_id: 'brisk_walk_loop', timestamp: `${date}T10:00:00+05:30`, outcome, ...over }
  }

  it('starts empty and honest', () => {
    const m = computeValueMetrics([])
    expect(m).toMatchObject({ recommendations: 0, answered: 0, start_rate: null, relevance: null, reflection_rate: null })
    expect(describeMetrics(m)).toEqual([])
  })

  it('counts participation and the recommendation-to-start rate among answered missions', () => {
    const m = computeValueMetrics([ev('completed', '2026-10-01'), ev('partial', '2026-10-02'), ev('skipped', '2026-10-03'), ev('changed', '2026-10-04'), ev('pending', '2026-10-05')])
    expect(m.recommendations).toBe(5)
    expect(m.answered).toBe(4)
    expect(m.participation).toEqual({ full: 1, partial: 1, not_started: 1, something_else: 1 })
    expect(m.start_rate).toBe(0.5)
  })

  it('measures satisfaction and feeling better, only from missions that happened', () => {
    const m = computeValueMetrics([
      ev('completed', '2026-10-01', { enjoyment: 5, feeling: 'calmer' }),
      ev('completed', '2026-10-02', { enjoyment: 4, feeling: 'same' }),
      ev('partial', '2026-10-03', { feeling: 'more_energetic' }),
      ev('skipped', '2026-10-04', { enjoyment: 1, feeling: 'more_tired' }),
    ])
    expect(m.satisfaction).toEqual({ average_enjoyment: 4.5, rated: 2, felt_better: 2, felt_count: 3 })
  })

  it('counts voluntary repeats and what they said about repeating', () => {
    const m = computeValueMetrics([ev('completed', '2026-10-01', { would_repeat: 'yes' }), ev('completed', '2026-10-02', { would_repeat: 'maybe' }), ev('completed', '2026-10-03', { activity_id: 'easy_jog', would_repeat: 'no' })])
    expect(m.repeat).toEqual({ would_repeat_yes: 1, would_repeat_maybe: 1, would_repeat_no: 1, done_again: 1 })
  })

  it('measures recovery: picking it back up within a week after a mission that did not start', () => {
    const m = computeValueMetrics([ev('skipped', '2026-10-01'), ev('completed', '2026-10-05'), ev('skipped', '2026-10-10'), ev('completed', '2026-10-20')])
    expect(m.recovery).toEqual({ missed: 2, resumed: 1 })
  })

  it('compares early and recent only with enough answers, and says nothing when it is a wash', () => {
    const few = computeValueMetrics(Array.from({ length: 6 }, (_, i) => ev('completed', `2026-10-0${i + 1}`)))
    expect(few.relevance).toBeNull()
    const improving = computeValueMetrics([...Array.from({ length: 4 }, (_, i) => ev('skipped', `2026-10-0${i + 1}`)), ...Array.from({ length: 4 }, (_, i) => ev('completed', `2026-10-1${i}`))])
    expect(improving.relevance).toMatchObject({ first_half_start_rate: 0, latest_half_start_rate: 1, improving: true })
    const same = computeValueMetrics(Array.from({ length: 8 }, (_, i) => ev(i % 2 ? 'completed' : 'skipped', `2026-10-0${i + 1}`)))
    expect(same.relevance?.improving).toBeNull()
    const worse = computeValueMetrics([...Array.from({ length: 4 }, (_, i) => ev('completed', `2026-10-0${i + 1}`)), ...Array.from({ length: 4 }, (_, i) => ev('skipped', `2026-10-1${i}`))])
    expect(worse.relevance?.improving).toBe(false)
  })

  it('measures how many started missions came with a reflection', () => {
    const m = computeValueMetrics([ev('completed', '2026-10-01', { has_reflection: true }), ev('completed', '2026-10-02'), ev('skipped', '2026-10-03', { has_reflection: true })])
    expect(m.reflection_rate).toBe(0.5)
  })

  it('describes only what the numbers support, kindly, and never mentions app time or streaks', () => {
    const lines = describeMetrics(
      computeValueMetrics([ev('completed', '2026-10-01', { enjoyment: 5, feeling: 'calmer' }), ev('completed', '2026-10-02', { enjoyment: 4, feeling: 'happier' }), ev('completed', '2026-10-03'), ev('skipped', '2026-10-05'), ev('completed', '2026-10-06')]),
    )
    expect(lines.length).toBeGreaterThanOrEqual(3)
    for (const l of lines) expect(l).not.toMatch(/streak|time in the app|minutes in the app|fail|lazy|should|behind/i)
    expect(lines.join(' ')).toMatch(/real attempt/)
    expect(describeMetrics(computeValueMetrics([ev('completed', '2026-10-01')]))).toEqual([]) // one answer says nothing
  })

  it('words a missed mission kindly when they did not pick it up again', () => {
    const lines = describeMetrics(computeValueMetrics([ev('skipped', '2026-10-01'), ev('skipped', '2026-10-02'), ev('skipped', '2026-10-03')]))
    expect(lines.join(' ')).toMatch(/starting again is always allowed/)
  })
})
