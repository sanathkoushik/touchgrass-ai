import { getActivity } from './engine/activities'
import type { Feeling, Outcome, WouldRepeat } from './engine/types'

/**
 * Real-world value, not app time (the document's §9). Computed from the person's own answers; there is no timer, no
 * streak and no "time in app" anywhere in here, on purpose.
 */

export interface MetricEvent {
  activity_id: string
  /** Local wall-clock time, e.g. "2026-10-07T17:42:00+05:30". */
  timestamp: string
  outcome: Outcome | 'pending'
  enjoyment?: number
  feeling?: Feeling
  would_repeat?: WouldRepeat
  has_reflection?: boolean
}

export interface ValueMetrics {
  /** Every mission suggested, answered or not. */
  recommendations: number
  answered: number
  /** How often a recommendation led to a genuine attempt (full or partial), among those answered. Null until something is answered. */
  start_rate: number | null
  participation: { full: number; partial: number; not_started: number; something_else: number }
  satisfaction: {
    /** Average enjoyment 1-5 among missions rated. */
    average_enjoyment: number | null
    rated: number
    /** Of the missions where they said how they felt: how many left them calmer, more energetic or happier. */
    felt_better: number
    felt_count: number
  }
  repeat: {
    would_repeat_yes: number
    would_repeat_maybe: number
    would_repeat_no: number
    /** Activities they have chosen to do at least twice. */
    done_again: number
  }
  /** After a mission that did not start, did they go on another within a week? */
  recovery: { missed: number; resumed: number }
  /** Is it getting better? Compares the first and latest halves (only when there are enough answers to compare). */
  relevance: { first_half_start_rate: number; latest_half_start_rate: number; improving: boolean | null } | null
  /** Share of started missions that came with a short reflection. */
  reflection_rate: number | null
}

const started = (e: MetricEvent) => e.outcome === 'completed' || e.outcome === 'partial'
const day = (ts: string) => Date.UTC(Number(ts.slice(0, 4)), Number(ts.slice(5, 7)) - 1, Number(ts.slice(8, 10))) / 86_400_000

export function computeValueMetrics(events: MetricEvent[]): ValueMetrics {
  const ordered = [...events].sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0))
  const answered = ordered.filter((e) => e.outcome !== 'pending')
  const done = answered.filter(started)

  const participation = {
    full: answered.filter((e) => e.outcome === 'completed').length,
    partial: answered.filter((e) => e.outcome === 'partial').length,
    not_started: answered.filter((e) => e.outcome === 'skipped').length,
    something_else: answered.filter((e) => e.outcome === 'changed').length,
  }

  const ratings = done.filter((e) => typeof e.enjoyment === 'number').map((e) => e.enjoyment!)
  const felt = done.filter((e) => e.feeling)
  const better = felt.filter((e) => e.feeling === 'calmer' || e.feeling === 'more_energetic' || e.feeling === 'happier').length

  const counts = new Map<string, number>()
  for (const e of done) counts.set(e.activity_id, (counts.get(e.activity_id) ?? 0) + 1)

  // Recovery: a mission that did not start, followed by a started one within 7 days.
  let missed = 0
  let resumed = 0
  answered.forEach((e, i) => {
    if (e.outcome !== 'skipped') return
    missed += 1
    const next = answered.slice(i + 1).find(started)
    if (next && day(next.timestamp) - day(e.timestamp) <= 7) resumed += 1
  })

  let relevance: ValueMetrics['relevance'] = null
  if (answered.length >= 8) {
    const mid = Math.floor(answered.length / 2)
    const rate = (xs: MetricEvent[]) => xs.filter(started).length / xs.length
    const a = rate(answered.slice(0, mid))
    const b = rate(answered.slice(mid))
    relevance = { first_half_start_rate: a, latest_half_start_rate: b, improving: Math.abs(b - a) < 0.1 ? null : b > a }
  }

  return {
    recommendations: ordered.length,
    answered: answered.length,
    start_rate: answered.length ? done.length / answered.length : null,
    participation,
    satisfaction: {
      average_enjoyment: ratings.length ? Math.round((ratings.reduce((s, x) => s + x, 0) / ratings.length) * 10) / 10 : null,
      rated: ratings.length,
      felt_better: better,
      felt_count: felt.length,
    },
    repeat: {
      would_repeat_yes: done.filter((e) => e.would_repeat === 'yes').length,
      would_repeat_maybe: done.filter((e) => e.would_repeat === 'maybe').length,
      would_repeat_no: done.filter((e) => e.would_repeat === 'no').length,
      done_again: [...counts.values()].filter((n) => n >= 2).length,
    },
    recovery: { missed, resumed },
    relevance,
    reflection_rate: done.length ? done.filter((e) => e.has_reflection).length / done.length : null,
  }
}

/** Plain-language lines for the person's own "real-world value" panel. Only says what the numbers support. */
export function describeMetrics(m: ValueMetrics): string[] {
  const lines: string[] = []
  const pct = (x: number) => `${Math.round(x * 100)}%`
  if (m.start_rate !== null && m.answered >= 3) {
    lines.push(`${pct(m.start_rate)} of the missions you answered led to a real attempt (${m.participation.full} in full, ${m.participation.partial} in part).`)
  }
  if (m.satisfaction.average_enjoyment !== null && m.satisfaction.rated >= 2) {
    lines.push(`You rated your missions ${m.satisfaction.average_enjoyment} out of 5 on average.`)
  }
  if (m.satisfaction.felt_count >= 2) {
    lines.push(`${m.satisfaction.felt_better} of ${m.satisfaction.felt_count} missions left you calmer, more energetic or happier.`)
  }
  if (m.repeat.done_again > 0) {
    lines.push(`You chose to do ${m.repeat.done_again} ${m.repeat.done_again === 1 ? 'activity' : 'activities'} more than once.`)
  }
  if (m.recovery.missed > 0) {
    lines.push(m.recovery.resumed > 0 ? `After ${m.recovery.missed} missed ${m.recovery.missed === 1 ? 'mission' : 'missions'}, you picked it back up within a week ${m.recovery.resumed} ${m.recovery.resumed === 1 ? 'time' : 'times'}.` : `${m.recovery.missed} ${m.recovery.missed === 1 ? 'mission' : 'missions'} did not happen. That is part of it, and starting again is always allowed.`)
  }
  if (m.relevance?.improving === true) lines.push('Your recent missions have been getting started more often than your early ones.')
  return lines
}

export const activityTitle = (id: string) => getActivity(id)?.title ?? id

/** One arm of the experiment, summed across people. */
export interface FlowStat {
  flow: 'companion' | 'classic'
  recommendations: number
  started: number
  full: number
  partial: number
  declined: number
  unanswered: number
  /** Average enjoyment (1-5) among rated missions, or null. */
  average_enjoyment: number | null
  would_repeat_yes: number
  with_reflection: number
}
