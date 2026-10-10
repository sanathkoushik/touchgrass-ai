import type { StoredProfile } from '@/shared/api'
import type { Outcome, SkipReason } from '@/shared/engine/types'
import type { Reflection } from '@/shared/mission-record'
import type { FlowStat, Repository, StoredEvent } from './repository'

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
  started_at: string | null
  reflection: string | null
  context: string
}

const EVENT_COLUMNS =
  'recommendation_id, activity_id, timestamp, outcome, enjoyment, skip_reason, responded_at, minutes_outside, quests_done, started_at, reflection, context'

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
  if (row.started_at !== null) event.started_at = row.started_at
  if (row.reflection !== null) {
    try {
      event.reflection = JSON.parse(row.reflection) as Reflection
    } catch {
      /* an unreadable reflection is treated as absent rather than breaking the person's history */
    }
  }
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
      // Uses idx_events_user_created: reads only the rows it deletes. Only UNANSWERED suggestions expire: every answered
      // mission (done, partly done, or honestly not done) is KEPT, because the Meadow and what is learned are built from
      // them and must never shrink as time passes.
      this.db
        .prepare("DELETE FROM events WHERE user_key = ? AND created_at < ? AND outcome = 'pending'")
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
        `UPDATE events SET activity_id = ?, outcome = ?, enjoyment = ?, skip_reason = ?, responded_at = ?, minutes_outside = ?, quests_done = ?, started_at = ?, reflection = ?, context = ?
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
        event.started_at ?? null,
        event.reflection && Object.keys(event.reflection).length > 0 ? JSON.stringify(event.reflection) : null,
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

  async listAnswered(userKey: string, limit: number): Promise<StoredEvent[]> {
    const { results } = await this.db
      .prepare(
        `SELECT ${EVENT_COLUMNS} FROM events WHERE user_key = ? AND outcome != 'pending'
         ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      )
      .bind(userKey, limit)
      .all<EventRow>()
    return results.map(rowToEvent)
  }

  async flowStats(): Promise<FlowStat[]> {
    // Aggregates only: no user_key, no activity, nothing that identifies anyone.
    const { results } = await this.db
      .prepare(
        `SELECT COALESCE(json_extract(context, '$.flow'), 'companion') AS flow,
                COUNT(*) AS recommendations,
                SUM(outcome IN ('completed', 'partial')) AS started,
                SUM(outcome = 'completed') AS full,
                SUM(outcome = 'partial') AS partial,
                SUM(outcome IN ('skipped', 'changed')) AS declined,
                SUM(outcome = 'pending') AS unanswered,
                AVG(enjoyment) AS average_enjoyment,
                SUM(json_extract(reflection, '$.would_repeat') = 'yes') AS would_repeat_yes,
                SUM(reflection IS NOT NULL) AS with_reflection
         FROM events GROUP BY flow`,
      )
      .all<Record<string, number | string | null>>()
    return results.map((r) => ({
      flow: r.flow === 'classic' ? 'classic' : 'companion',
      recommendations: Number(r.recommendations ?? 0),
      started: Number(r.started ?? 0),
      full: Number(r.full ?? 0),
      partial: Number(r.partial ?? 0),
      declined: Number(r.declined ?? 0),
      unanswered: Number(r.unanswered ?? 0),
      average_enjoyment: r.average_enjoyment === null || r.average_enjoyment === undefined ? null : Math.round(Number(r.average_enjoyment) * 100) / 100,
      would_repeat_yes: Number(r.would_repeat_yes ?? 0),
      with_reflection: Number(r.with_reflection ?? 0),
    }))
  }
}
