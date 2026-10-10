import type { StoredProfile } from '@/shared/api'
import type { Outcome, SkipReason } from '@/shared/engine/types'
import type { Repository, StoredEvent } from './repository'

/** Events older than this are deleted on write, keeping storage (and the free-tier row budget) bounded. */
const RETENTION_DAYS = 180
const DAY_MS = 86_400_000

/** Raw row shape of the `events` table. */
interface EventRow {
  recommendation_id: string
  activity_id: string
  timestamp: string
  outcome: Outcome | 'pending'
  enjoyment: number | null
  skip_reason: SkipReason | null
  responded_at: string | null
  minutes_outside: number | null
  quests_done: number | null
  context: string
}

const EVENT_COLUMNS =
  'recommendation_id, activity_id, timestamp, outcome, enjoyment, skip_reason, responded_at, minutes_outside, quests_done, context'

function rowToEvent(row: EventRow): StoredEvent {
  const event: StoredEvent = {
    recommendation_id: row.recommendation_id,
    activity_id: row.activity_id,
    timestamp: row.timestamp,
    outcome: row.outcome,
    context: JSON.parse(row.context) as StoredEvent['context'],
  }
  if (row.enjoyment !== null) event.enjoyment = row.enjoyment
  if (row.skip_reason !== null) event.skip_reason = row.skip_reason
  if (row.responded_at !== null) event.responded_at = row.responded_at
  if (row.minutes_outside !== null) event.minutes_outside = row.minutes_outside
  if (row.quests_done !== null) event.quests_done = row.quests_done
  return event
}

/**
 * Cloudflare D1 storage. Every statement is parameterised (`?` + bind), never string-built,
 * and every query is scoped by `user_key`, so one user can never reach another's rows.
 */
export class D1Repository implements Repository {
  private readonly db: D1Database
  private readonly nowMs: () => number

  /** `nowMs` is an injectable clock for the creation timestamp and retention cut-off (tests). */
  constructor(db: D1Database, nowMs: () => number = Date.now) {
    this.db = db
    this.nowMs = nowMs
  }

  async getProfile(userKey: string): Promise<StoredProfile | null> {
    const row = await this.db.prepare('SELECT data FROM profiles WHERE user_key = ?').bind(userKey).first<{ data: string }>()
    return row ? (JSON.parse(row.data) as StoredProfile) : null
  }

  async saveProfile(userKey: string, profile: StoredProfile): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO profiles (user_key, data, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(user_key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      )
      .bind(userKey, JSON.stringify(profile), profile.updated_at)
      .run()
  }

  async deleteUser(userKey: string): Promise<void> {
    // One atomic batch: either everything about the user goes, or nothing does.
    await this.db.batch([
      this.db.prepare('DELETE FROM events WHERE user_key = ?').bind(userKey),
      this.db.prepare('DELETE FROM profiles WHERE user_key = ?').bind(userKey),
    ])
  }

  async addEvent(userKey: string, event: StoredEvent): Promise<void> {
    const now = this.nowMs()
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO events (user_key, recommendation_id, activity_id, timestamp, created_at, outcome, enjoyment, skip_reason, responded_at, context)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          userKey,
          event.recommendation_id,
          event.activity_id,
          event.timestamp,
          now,
          event.outcome,
          event.enjoyment ?? null,
          event.skip_reason ?? null,
          event.responded_at ?? null,
          JSON.stringify(event.context),
        ),
      // Uses idx_events_user_created: reads only the rows it deletes. Completed and partial missions are KEPT: the
      // Meadow (time outside, milestones) is built from them and must never shrink as time passes.
      this.db
        .prepare("DELETE FROM events WHERE user_key = ? AND created_at < ? AND outcome NOT IN ('completed', 'partial')")
        .bind(userKey, now - RETENTION_DAYS * DAY_MS),
    ])
  }

  async getEvent(userKey: string, recommendationId: string): Promise<StoredEvent | null> {
    const row = await this.db
      .prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE user_key = ? AND recommendation_id = ?`)
      .bind(userKey, recommendationId)
      .first<EventRow>()
    return row ? rowToEvent(row) : null
  }

  async updateEvent(userKey: string, event: StoredEvent): Promise<void> {
    const result = await this.db
      .prepare(
        `UPDATE events SET activity_id = ?, outcome = ?, enjoyment = ?, skip_reason = ?, responded_at = ?, minutes_outside = ?, quests_done = ?, context = ?
         WHERE user_key = ? AND recommendation_id = ?`,
      )
      .bind(
        event.activity_id,
        event.outcome,
        event.enjoyment ?? null,
        event.skip_reason ?? null,
        event.responded_at ?? null,
        event.minutes_outside ?? null,
        event.quests_done ?? null,
        JSON.stringify(event.context),
        userKey,
        event.recommendation_id,
      )
      .run()
    if (result.meta.changes === 0) throw new Error('event not found')
  }

  async listEvents(userKey: string, limit: number): Promise<StoredEvent[]> {
    const { results } = await this.db
      .prepare(
        `SELECT ${EVENT_COLUMNS} FROM events WHERE user_key = ?
         ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      )
      .bind(userKey, limit)
      .all<EventRow>()
    return results.map(rowToEvent)
  }

  async listCredited(userKey: string, limit: number): Promise<StoredEvent[]> {
    const { results } = await this.db
      .prepare(
        `SELECT ${EVENT_COLUMNS} FROM events WHERE user_key = ? AND outcome IN ('completed', 'partial')
         ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      )
      .bind(userKey, limit)
      .all<EventRow>()
    return results.map(rowToEvent)
  }
}
