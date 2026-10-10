import type { StoredProfile } from '@/shared/api'
import type { FlowStat } from '@/shared/metrics'
import type { Reflection } from '@/shared/mission-record'

export type { FlowStat }
import type { ActivityMode, DesiredOutcome, ModeCause, Mood, Outcome, SkipReason, SocialMode, WeatherCategory } from '@/shared/engine/types'

/** One recommendation and what happened to it. `pending` until the user reports back. */
export interface StoredEvent {
  recommendation_id: string
  activity_id: string
  /** Local wall-clock time with the user's UTC offset, e.g. "2026-10-07T17:42:00+05:30". */
  timestamp: string
  outcome: Outcome | 'pending'
  enjoyment?: number
  skip_reason?: SkipReason
  /** UTC ISO time when the user reported the outcome. */
  responded_at?: string
  /** Minutes away from the app for this mission (measured, or as the person said). */
  minutes_outside?: number
  /** Side quests ticked off during this mission. */
  quests_done?: number
  /** When the person set off (ISO), from the "Let's go" tap on their device. */
  started_at?: string
  /** What they told us afterwards. The photo, if any, stays on their device. */
  reflection?: Reflection
  context: {
    duration_limit: number
    mood: Mood
    social_available: boolean
    hour: number
    /** Minutes the app planned, so time outside can be credited honestly later. */
    planned_min?: number
    /** What they wanted out of this one, from the check-in. */
    desired_outcome?: DesiredOutcome
    /** Who it was planned for (solo, with a friend, small group). */
    social_mode?: SocialMode
    /** Which flow they had: the Mission Companion or the earlier plain one (see the experiment switch). */
    flow?: 'companion' | 'classic'
    /** When the recommendation was made (UTC ISO). */
    created_at?: string
    /** How big this recommendation was, and why, so the AI upgrade rebuilds the same situation. */
    mode?: ActivityMode
    mode_cause?: ModeCause
    /** Live conditions used for this recommendation. Only the category and temperature: never coordinates. */
    weather?: { category: WeatherCategory; temp_c: number }
    /** True/false when real daylight was known; absent when not. */
    is_daylight?: boolean
    /**
     * Set once the AI upgrade has been tried for this recommendation, so it is tried at most once
     * (protects the free daily AI quota): 'ai' = wording/choice upgraded, 'failed' = AI could not help.
     */
    upgrade?: 'ai' | 'failed'
  }
}

/**
 * Everything the API needs from storage. `userKey` is the SHA-256 of the anonymous session id,
 * so a leaked database does not reveal usable session ids.
 *
 * Stage 5 ships MemoryRepository; Stage 6 adds a MongoDB implementation behind this same interface.
 */
export interface Repository {
  getProfile(userKey: string): Promise<StoredProfile | null>
  saveProfile(userKey: string, profile: StoredProfile): Promise<void>
  /** Removes the profile and all events for this user. */
  deleteUser(userKey: string): Promise<void>
  addEvent(userKey: string, event: StoredEvent): Promise<void>
  getEvent(userKey: string, recommendationId: string): Promise<StoredEvent | null>
  updateEvent(userKey: string, event: StoredEvent): Promise<void>
  /** Newest first. */
  listEvents(userKey: string, limit: number): Promise<StoredEvent[]>
  /**
   * Newest first: only completed and partial missions, of ANY age. These are never pruned, because the Meadow
   * (time outside, milestones) is built from them and must never shrink.
   */
  listCredited(userKey: string, limit: number): Promise<StoredEvent[]>
  /**
   * Newest first: every ANSWERED mission (anything but pending), of any age. Honest "it did not happen" answers are
   * kept like the completed ones, because the Meadow recognises them and what is learned is built from them.
   */
  listAnswered(userKey: string, limit: number): Promise<StoredEvent[]>
  /** Anonymous totals per flow across everyone, for the experiment. Contains no user identifiers. */
  flowStats(): Promise<FlowStat[]>
}

const MAX_EVENTS_PER_USER = 500

/** Non-persistent storage for local development and tests. Data is lost when the process restarts. */
export class MemoryRepository implements Repository {
  private profiles = new Map<string, StoredProfile>()
  private events = new Map<string, StoredEvent[]>() // oldest -> newest

  async getProfile(userKey: string) {
    const p = this.profiles.get(userKey)
    return p ? structuredClone(p) : null
  }

  async saveProfile(userKey: string, profile: StoredProfile) {
    this.profiles.set(userKey, structuredClone(profile))
  }

  async deleteUser(userKey: string) {
    this.profiles.delete(userKey)
    this.events.delete(userKey)
  }

  async addEvent(userKey: string, event: StoredEvent) {
    const list = this.events.get(userKey) ?? []
    // Same rule as the database primary key (user_key, recommendation_id).
    if (list.some((x) => x.recommendation_id === event.recommendation_id)) throw new Error('duplicate recommendation id')
    list.push(structuredClone(event))
    // Bound memory: drop the oldest UNANSWERED events beyond the cap. Answered ones (the Meadow and what is learned are
    // built from them) go only if there is nothing else left to drop.
    while (list.length > MAX_EVENTS_PER_USER) {
      const i = list.findIndex((x) => x.outcome === 'pending')
      list.splice(i === -1 ? 0 : i, 1)
    }
    this.events.set(userKey, list)
  }

  async getEvent(userKey: string, recommendationId: string) {
    const e = this.events.get(userKey)?.find((x) => x.recommendation_id === recommendationId)
    return e ? structuredClone(e) : null
  }

  async updateEvent(userKey: string, event: StoredEvent) {
    const list = this.events.get(userKey)
    const i = list?.findIndex((x) => x.recommendation_id === event.recommendation_id) ?? -1
    if (!list || i === -1) throw new Error('event not found')
    list[i] = structuredClone(event)
  }

  async listEvents(userKey: string, limit: number) {
    const list = this.events.get(userKey) ?? []
    return structuredClone(list.slice(-limit).reverse())
  }

  async listAnswered(userKey: string, limit: number) {
    const list = (this.events.get(userKey) ?? []).filter((e) => e.outcome !== 'pending')
    return structuredClone(list.slice(-limit).reverse())
  }

  async flowStats(): Promise<FlowStat[]> {
    const arms = new Map<'companion' | 'classic', StoredEvent[]>()
    for (const list of this.events.values()) {
      for (const e of list) {
        const flow = e.context.flow ?? 'companion'
        arms.set(flow, [...(arms.get(flow) ?? []), e])
      }
    }
    return [...arms.entries()].map(([flow, events]) => {
      const rated = events.filter((e) => typeof e.enjoyment === 'number')
      return {
        flow,
        recommendations: events.length,
        started: events.filter((e) => e.outcome === 'completed' || e.outcome === 'partial').length,
        full: events.filter((e) => e.outcome === 'completed').length,
        partial: events.filter((e) => e.outcome === 'partial').length,
        declined: events.filter((e) => e.outcome === 'skipped' || e.outcome === 'changed').length,
        unanswered: events.filter((e) => e.outcome === 'pending').length,
        average_enjoyment: rated.length ? Math.round((rated.reduce((s, e) => s + (e.enjoyment ?? 0), 0) / rated.length) * 100) / 100 : null,
        would_repeat_yes: events.filter((e) => e.reflection?.would_repeat === 'yes').length,
        with_reflection: events.filter((e) => e.reflection && Object.keys(e.reflection).length > 0).length,
      }
    })
  }

  async listCredited(userKey: string, limit: number) {
    const list = (this.events.get(userKey) ?? []).filter((e) => e.outcome === 'completed' || e.outcome === 'partial')
    return structuredClone(list.slice(-limit).reverse())
  }
}
