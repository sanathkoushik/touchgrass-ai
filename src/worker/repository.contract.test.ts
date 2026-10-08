import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { StoredProfile } from '@/shared/api'
import type { Repository, StoredEvent } from './repository'
import { makeHarness, STORAGE_KINDS, type Harness } from './test-support'

// The same behavioural contract must hold for every Repository implementation.
// All data here is synthetic test data.

const U1 = 'a'.repeat(64)
const U2 = 'b'.repeat(64)
const DAY = 86_400_000

const profile = (over: Partial<StoredProfile> = {}): StoredProfile => ({
  preferences: { likes: ['walking'], dislikes: ['running'], preferred_duration_min: 45, social_preference: 'any' },
  motivators: ['novelty'],
  avoidances: ['too_far'],
  equipment: ['racket'],
  schedule_signals: { best_windows: ['17:30-19:30'] },
  updated_at: '2026-10-07T12:00:00.000Z',
  ...over,
})

const event = (id: string, over: Partial<StoredEvent> = {}): StoredEvent => ({
  recommendation_id: `r_${id}`,
  activity_id: 'brisk_walk_loop',
  timestamp: '2026-10-07T17:42:00+05:30',
  outcome: 'pending',
  context: { duration_limit: 60, mood: 'ok', social_available: false, hour: 17 },
  ...over,
})

describe.each(STORAGE_KINDS)('Repository contract: %s', (kind) => {
  let h: Harness
  let repo: Repository
  beforeAll(async () => {
    h = await makeHarness(kind)
  }, 60_000)
  afterAll(async () => {
    await h.dispose()
  })
  beforeEach(async () => {
    await h.reset()
    repo = h.create()
  })

  describe('profiles', () => {
    it('returns null when there is no profile', async () => {
      expect(await repo.getProfile(U1)).toBeNull()
    })

    it('round-trips a profile exactly', async () => {
      await repo.saveProfile(U1, profile())
      expect(await repo.getProfile(U1)).toStrictEqual(profile())
    })

    it('replaces the previous profile on save', async () => {
      await repo.saveProfile(U1, profile())
      await repo.saveProfile(U1, profile({ equipment: ['ball'], updated_at: '2026-10-08T00:00:00.000Z' }))
      const got = await repo.getProfile(U1)
      expect(got?.equipment).toEqual(['ball'])
      expect(got?.updated_at).toBe('2026-10-08T00:00:00.000Z')
    })

    it('keeps users separate', async () => {
      await repo.saveProfile(U1, profile())
      expect(await repo.getProfile(U2)).toBeNull()
    })

    it('stores hostile strings as plain data (no injection, no corruption)', async () => {
      const nasty = ["'; DROP TABLE profiles; --", '"quotes" and \\ backslashes', 'emoji 🌿 and ünïcödé', '\n newline']
      await repo.saveProfile(U1, profile({ preferences: { ...profile().preferences, likes: nasty } }))
      expect((await repo.getProfile(U1))?.preferences.likes).toEqual(nasty)
      // The table must still work afterwards.
      await repo.saveProfile(U2, profile())
      expect(await repo.getProfile(U2)).not.toBeNull()
    })
  })

  describe('events', () => {
    it('adds and reads an event back unchanged', async () => {
      const e = event('1', { context: { duration_limit: 45, mood: 'low', social_available: true, hour: 8, weather: 'clear' } })
      await repo.addEvent(U1, e)
      expect(await repo.getEvent(U1, 'r_1')).toStrictEqual(e)
    })

    it('does not invent fields: optional values stay absent, not null', async () => {
      await repo.addEvent(U1, event('1'))
      const got = await repo.getEvent(U1, 'r_1')
      expect(got).toBeTruthy()
      expect('enjoyment' in got!).toBe(false)
      expect('skip_reason' in got!).toBe(false)
      expect('responded_at' in got!).toBe(false)
    })

    it('returns null for an unknown id, and never across users', async () => {
      await repo.addEvent(U1, event('1'))
      expect(await repo.getEvent(U1, 'r_missing')).toBeNull()
      expect(await repo.getEvent(U2, 'r_1')).toBeNull()
    })

    it('updates the outcome and can clear fields again', async () => {
      await repo.addEvent(U1, event('1'))
      await repo.updateEvent(U1, event('1', { outcome: 'skipped', skip_reason: 'boring', responded_at: '2026-10-07T13:00:00.000Z' }))
      expect(await repo.getEvent(U1, 'r_1')).toMatchObject({ outcome: 'skipped', skip_reason: 'boring' })

      await repo.updateEvent(U1, event('1', { outcome: 'completed', enjoyment: 4, responded_at: '2026-10-07T14:00:00.000Z' }))
      const got = await repo.getEvent(U1, 'r_1')
      expect(got).toMatchObject({ outcome: 'completed', enjoyment: 4 })
      expect('skip_reason' in got!).toBe(false)
    })

    it('refuses to update an event that does not exist, or belongs to someone else', async () => {
      await expect(repo.updateEvent(U1, event('nope', { outcome: 'completed' }))).rejects.toThrow()
      await repo.addEvent(U1, event('1'))
      await expect(repo.updateEvent(U2, event('1', { outcome: 'completed' }))).rejects.toThrow()
      expect((await repo.getEvent(U1, 'r_1'))?.outcome).toBe('pending')
    })

    it('lists newest first, honours the limit, and scopes by user', async () => {
      for (const id of ['1', '2', '3', '4']) await repo.addEvent(U1, event(id))
      await repo.addEvent(U2, event('x'))
      expect((await repo.listEvents(U1, 10)).map((e) => e.recommendation_id)).toEqual(['r_4', 'r_3', 'r_2', 'r_1'])
      expect((await repo.listEvents(U1, 2)).map((e) => e.recommendation_id)).toEqual(['r_4', 'r_3'])
      expect((await repo.listEvents(U2, 10)).map((e) => e.recommendation_id)).toEqual(['r_x'])
      expect(await repo.listEvents('c'.repeat(64), 10)).toEqual([])
    })

    it('keeps insertion order even when events share the same millisecond', async () => {
      const frozen = h.create(() => 1_700_000_000_000)
      for (const id of ['1', '2', '3']) await frozen.addEvent(U1, event(id))
      expect((await frozen.listEvents(U1, 10)).map((e) => e.recommendation_id)).toEqual(['r_3', 'r_2', 'r_1'])
    })

    it('rejects a duplicate recommendation id for the same user', async () => {
      await repo.addEvent(U1, event('1'))
      await expect(repo.addEvent(U1, event('1'))).rejects.toThrow()
    })
  })

  describe('deleting a user', () => {
    it('removes their profile and all events, and nobody else’s', async () => {
      await repo.saveProfile(U1, profile())
      await repo.saveProfile(U2, profile())
      await repo.addEvent(U1, event('1'))
      await repo.addEvent(U2, event('2'))

      await repo.deleteUser(U1)

      expect(await repo.getProfile(U1)).toBeNull()
      expect(await repo.listEvents(U1, 10)).toEqual([])
      expect(await repo.getProfile(U2)).not.toBeNull()
      expect((await repo.listEvents(U2, 10)).length).toBe(1)
    })

    it('is harmless for an unknown user', async () => {
      await expect(repo.deleteUser(U1)).resolves.toBeUndefined()
    })
  })

  // Retention is a D1 feature: it protects the free tier's storage and row budgets.
  describe.runIf(kind === 'd1')('retention (D1)', () => {
    it('prunes events older than 180 days, for that user only, when a new event is added', async () => {
      const t0 = 1_800_000_000_000
      const early = h.create(() => t0)
      await early.addEvent(U1, event('old'))
      await early.addEvent(U2, event('other-old'))

      const later = h.create(() => t0 + 181 * DAY)
      await later.addEvent(U1, event('fresh'))

      expect((await later.listEvents(U1, 10)).map((e) => e.recommendation_id)).toEqual(['r_fresh'])
      // U2 wrote nothing new, so their (old) data is untouched until they next write.
      expect((await later.listEvents(U2, 10)).map((e) => e.recommendation_id)).toEqual(['r_other-old'])
    })

    it('keeps events younger than 180 days', async () => {
      const t0 = 1_800_000_000_000
      await h.create(() => t0).addEvent(U1, event('a'))
      const later = h.create(() => t0 + 179 * DAY)
      await later.addEvent(U1, event('b'))
      expect((await later.listEvents(U1, 10)).length).toBe(2)
    })
  })

  describe.runIf(kind === 'd1')('schema guards (D1)', () => {
    it('refuses an invalid outcome or out-of-range enjoyment at the database level', async () => {
      await expect(repo.addEvent(U1, event('1', { outcome: 'abandoned' as never }))).rejects.toThrow()
      await expect(repo.addEvent(U1, event('2', { outcome: 'completed', enjoyment: 9 }))).rejects.toThrow()
    })
  })
})
