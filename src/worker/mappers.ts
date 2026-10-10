import { getActivity } from '@/shared/engine'
import type { HistoryEvent } from '@/shared/engine/types'
import type { LearnEvent } from '@/shared/learned'
import type { MeadowEvent } from '@/shared/meadow'
import { creditedMinutes } from '@/shared/meadow'
import type { MetricEvent } from '@/shared/metrics'
import { evidenceFor, participationOf, supportLevel, type MemoryItem } from '@/shared/mission-record'
import type { StoredEvent } from './repository'

/** Turns stored events into what each part of the system needs. All pure. */

const hasNote = (e: StoredEvent) => !!e.reflection?.note && e.reflection.note.trim().length > 0

/** What the Meadow needs. */
export function toMeadowEvent(e: StoredEvent): MeadowEvent {
  return {
    activity_id: e.activity_id,
    timestamp: e.timestamp,
    outcome: e.outcome,
    ...(e.enjoyment !== undefined ? { enjoyment: e.enjoyment } : {}),
    ...(e.minutes_outside !== undefined ? { minutes_outside: e.minutes_outside } : {}),
    ...(e.quests_done !== undefined ? { quests_done: e.quests_done } : {}),
    ...(e.context.planned_min !== undefined ? { planned_min: e.context.planned_min } : {}),
    ...(e.context.social_mode ? { social_mode: e.context.social_mode } : {}),
    ...(hasNote(e) ? { has_note: true } : {}),
    ...(e.reflection?.has_photo ? { has_photo: true } : {}),
  }
}

/** What the recommendation engine learns from. Only answered recommendations teach it anything. */
export function toHistory(events: StoredEvent[]): HistoryEvent[] {
  const out: HistoryEvent[] = []
  for (const e of events) {
    if (e.outcome === 'pending') continue
    out.push({
      activity_id: e.activity_id,
      timestamp: e.timestamp,
      outcome: e.outcome,
      ...(e.enjoyment !== undefined ? { enjoyment: e.enjoyment } : {}),
      ...(e.skip_reason !== undefined ? { skip_reason: e.skip_reason } : {}),
      ...(e.context.planned_min !== undefined ? { planned_min: e.context.planned_min } : {}),
      ...(e.reflection?.feeling ? { feeling: e.reflection.feeling } : {}),
      ...(e.reflection?.would_repeat ? { would_repeat: e.reflection.would_repeat } : {}),
      ...(e.reflection?.barrier ? { barrier: e.reflection.barrier } : {}),
      ...(e.reflection?.helper ? { helper: e.reflection.helper } : {}),
      ...(e.context.social_mode ? { social_mode: e.context.social_mode } : {}),
      ...(e.responded_at ? { responded_at: e.responded_at } : {}),
    })
  }
  return out
}

/** What the learner needs (the same fields, in its own shape). */
export function toLearnEvent(e: StoredEvent): LearnEvent {
  return {
    activity_id: e.activity_id,
    timestamp: e.timestamp,
    outcome: e.outcome,
    ...(e.enjoyment !== undefined ? { enjoyment: e.enjoyment } : {}),
    ...(e.context.planned_min !== undefined ? { planned_min: e.context.planned_min } : {}),
    ...(e.skip_reason !== undefined ? { skip_reason: e.skip_reason } : {}),
    ...(e.reflection?.barrier ? { barrier: e.reflection.barrier } : {}),
    ...(e.reflection?.helper ? { helper: e.reflection.helper } : {}),
    ...(e.reflection?.feeling ? { feeling: e.reflection.feeling } : {}),
    ...(e.reflection?.would_repeat ? { would_repeat: e.reflection.would_repeat } : {}),
    ...(e.context.social_mode ? { social_mode: e.context.social_mode } : {}),
    ...(e.responded_at ? { responded_at: e.responded_at } : {}),
  }
}

/** What the person's own "real-world value" panel needs. */
export function toMetricEvent(e: StoredEvent): MetricEvent {
  const r = e.reflection
  return {
    activity_id: e.activity_id,
    timestamp: e.timestamp,
    outcome: e.outcome,
    ...(e.enjoyment !== undefined ? { enjoyment: e.enjoyment } : {}),
    ...(r?.feeling ? { feeling: r.feeling } : {}),
    ...(r?.would_repeat ? { would_repeat: r.would_repeat } : {}),
    ...(r && (r.feeling || r.helper || r.barrier || r.would_repeat || hasNote(e)) ? { has_reflection: true } : {}),
  }
}

export function toMemoryItem(e: StoredEvent): MemoryItem {
  const a = getActivity(e.activity_id)
  const r = e.reflection
  const evidence = evidenceFor(e)
  return {
    mission_id: e.recommendation_id,
    activity_id: e.activity_id,
    title: a?.title ?? e.activity_id,
    family: a?.family ?? 'movement',
    timestamp: e.timestamp,
    participation: participationOf(e.outcome) ?? 'something_else',
    minutes: creditedMinutes(toMeadowEvent(e)),
    enjoyment: e.enjoyment ?? null,
    feeling: r?.feeling ?? null,
    helper: r?.helper ?? null,
    barrier: r?.barrier ?? null,
    would_repeat: r?.would_repeat ?? null,
    note: r?.note?.trim() ? r.note.trim() : null,
    has_photo: !!r?.has_photo,
    evidence,
    support: supportLevel(evidence),
  }
}
