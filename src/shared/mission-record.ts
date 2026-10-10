import type { DesiredOutcome, Family, Feeling, Helper, Mood, Outcome, ParticipationStatus, SkipReason, WouldRepeat } from './engine/types'

/**
 * The mission record (the document's §7) and how completion is described honestly.
 *
 * The principle: elapsed time, a photo or a note SUPPORT what the person said; none of them prove anything, and none of
 * them is ever used to accuse anyone or to take anything away. The person's word is the record, and "supported" /
 * "reflected on" only describe how much context there is around it.
 */

export type EvidenceKind = 'elapsed_time' | 'photo' | 'reflection'
/** What the record says supported the answer (the document's `evidence_type`). */
export type EvidenceType = 'none' | 'elapsed_time' | 'photo' | 'other'
/** The three levels from the document: self-reported, supported, reflected on. */
export type SupportLevel = 'self_reported' | 'supported' | 'reflected'

/** Everything the person tells us after a mission, beyond the outcome itself. All optional. */
export interface Reflection {
  feeling?: Feeling
  helper?: Helper
  /** What made it harder (shares the vocabulary of skip reasons). */
  barrier?: SkipReason
  would_repeat?: WouldRepeat
  /** The person's own words, up to 280 characters. This is the "memory". */
  note?: string
  /** True if they attached a photo. The photo itself stays on their device and is never uploaded. */
  has_photo?: boolean
  /** Whether the minutes were measured by the app (Let's go to I am back) or typed in by the person. */
  minutes_source?: 'measured' | 'stated'
}

export const NOTE_MAX = 280

export function participationOf(outcome: Outcome | 'pending'): ParticipationStatus | null {
  switch (outcome) {
    case 'completed':
      return 'full'
    case 'partial':
      return 'partial'
    case 'skipped':
      return 'not_started'
    case 'changed':
      return 'something_else'
    default:
      return null
  }
}

export interface EvidenceSource {
  outcome: Outcome | 'pending'
  planned_min?: number
  minutes_outside?: number
  reflection?: Reflection
  /** A stored mission keeps what was planned here. */
  context?: { planned_min?: number }
}

const hasReflection = (r: Reflection | undefined) => !!r && (r.feeling || r.helper || r.barrier || r.would_repeat || (r.note && r.note.trim().length > 0))

/**
 * The signals that sit around an answer. Recomputed from what is stored (so the rules can change without migrating),
 * and deliberately lenient: elapsed time only counts when the app measured it and it is plausible for the plan.
 */
export function evidenceFor(e: EvidenceSource): EvidenceKind[] {
  if (e.outcome !== 'completed' && e.outcome !== 'partial') return []
  const out: EvidenceKind[] = []
  const planned = e.planned_min ?? e.context?.planned_min ?? 0
  if (e.reflection?.minutes_source === 'measured' && typeof e.minutes_outside === 'number' && e.minutes_outside >= 1 && e.minutes_outside >= planned * 0.4) out.push('elapsed_time')
  if (e.reflection?.has_photo) out.push('photo')
  if (hasReflection(e.reflection)) out.push('reflection')
  return out
}

export function evidenceTypeOf(kinds: EvidenceKind[]): EvidenceType {
  if (kinds.includes('photo')) return 'photo'
  if (kinds.includes('elapsed_time')) return 'elapsed_time'
  if (kinds.includes('reflection')) return 'other'
  return 'none'
}

export function supportLevel(kinds: EvidenceKind[]): SupportLevel {
  if (kinds.includes('reflection')) return 'reflected'
  if (kinds.includes('elapsed_time') || kinds.includes('photo')) return 'supported'
  return 'self_reported'
}

/** Plain words for the three levels. They describe context, never trust: nobody is ever "unverified". */
export const SUPPORT_LABEL: Record<SupportLevel, string> = {
  self_reported: 'In your words',
  supported: 'With time or a photo alongside',
  reflected: 'With a reflection',
}

/** The fields the record is built from (a stored event satisfies this structurally). */
export interface MissionRecordSource extends EvidenceSource {
  recommendation_id: string
  activity_id: string
  timestamp: string
  responded_at?: string
  started_at?: string
  context: { duration_limit: number; mood: Mood; planned_min?: number; desired_outcome?: DesiredOutcome; created_at?: string }
}

/** The document's mission record, with its field names. Used for viewing and for downloading your own data. */
export interface MissionRecord {
  mission_id: string
  activity_type: string
  recommended_duration: number | null
  user_selected_duration: number
  mission_started_at: string | null
  mission_returned_at: string | null
  participation_status: ParticipationStatus | null
  evidence_type: EvidenceType
  pre_activity_energy: Mood
  desired_outcome: DesiredOutcome | null
  post_activity_feeling: Feeling | null
  difficulty_or_barrier: SkipReason | null
  would_repeat: WouldRepeat | null
  optional_reflection: string | null
  created_at: string
}

export function toMissionRecord(e: MissionRecordSource & { skip_reason?: SkipReason }): MissionRecord {
  const r = e.reflection
  return {
    mission_id: e.recommendation_id,
    activity_type: e.activity_id,
    recommended_duration: e.context.planned_min ?? null,
    user_selected_duration: e.context.duration_limit,
    mission_started_at: e.started_at ?? null,
    mission_returned_at: e.responded_at ?? null,
    participation_status: participationOf(e.outcome),
    evidence_type: evidenceTypeOf(evidenceFor(e)),
    pre_activity_energy: e.context.mood,
    desired_outcome: e.context.desired_outcome ?? null,
    post_activity_feeling: r?.feeling ?? null,
    difficulty_or_barrier: r?.barrier ?? e.skip_reason ?? null,
    would_repeat: r?.would_repeat ?? null,
    optional_reflection: r?.note?.trim() ? r.note.trim() : null,
    created_at: e.context.created_at ?? e.timestamp,
  }
}

/** One mission as a memory card: what happened, what they said about it, and how much context sits around the answer. */
export interface MemoryItem {
  mission_id: string
  activity_id: string
  title: string
  family: Family
  /** The person's local time. */
  timestamp: string
  participation: ParticipationStatus
  /** Minutes this added to the Meadow. */
  minutes: number
  enjoyment: number | null
  feeling: Feeling | null
  helper: Helper | null
  barrier: SkipReason | null
  would_repeat: WouldRepeat | null
  /** Their own words. */
  note: string | null
  /** A photo exists, on this person's own device (it is never uploaded). */
  has_photo: boolean
  evidence: EvidenceKind[]
  support: SupportLevel
}
