import type { StoredProfile } from '@/shared/api'
import type { Mood, Outcome, SkipReason } from '@/shared/engine/types'

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
  context: {
    duration_limit: number
    mood: Mood
    social_available: boolean
    hour: number
    /** Filled in once weather is wired up (Phase 9). */
    weather?: string
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
    list.push(structuredClone(event))
    // Bound memory: drop the oldest events beyond the cap.
    if (list.length > MAX_EVENTS_PER_USER) list.splice(0, list.length - MAX_EVENTS_PER_USER)
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
}
