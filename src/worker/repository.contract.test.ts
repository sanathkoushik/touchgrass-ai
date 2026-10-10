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
      const e = event('1', { context: { duration_limit: 45, mood: 'low', social_available: true, hour: 8, weather: { category: 'clear', temp_c: 24 }, is_daylight: true } })
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

    it('can change the activity and context of a pending event (AI upgrade) without touching its identity', async () => {
      await repo.addEvent(U1, event('1'))
      const upgraded = event('1', {
        activity_id: 'photo_walk_challenge',
        context: { duration_limit: 60, mood: 'ok', social_available: false, hour: 17, upgrade: 'ai' },
      })
      await repo.updateEvent(U1, upgraded)
      const got = await repo.getEvent(U1, 'r_1')
      expect(got).toStrictEqual(upgraded)
      expect((await repo.listEvents(U1, 10)).length).toBe(1)
      // The update is scoped by user: another user's identical id is not affected.
      await expect(repo.updateEvent(U2, upgraded)).rejects.toThrow()
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

    it('NEVER prunes an answered mission, however old (the Meadow and what is learned must not shrink)', async () => {
      const t0 = 1_800_000_000_000
      const early = h.create(() => t0)
      await early.addEvent(U1, event('done', { outcome: 'completed' }))
      await early.addEvent(U1, event('part', { outcome: 'partial' }))
      await early.addEvent(U1, event('skip', { outcome: 'skipped' }))
      await early.addEvent(U1, event('swap', { outcome: 'changed' }))
      await early.addEvent(U1, event('never-answered'))
      const later = h.create(() => t0 + 400 * DAY)
      await later.addEvent(U1, event('fresh'))
      const ids = (await later.listEvents(U1, 10)).map((e) => e.recommendation_id).sort()
      // Every ANSWERED mission is kept, honest "it did not happen" ones included; only the unanswered suggestion expired.
      expect(ids).toEqual(['r_done', 'r_fresh', 'r_part', 'r_skip', 'r_swap'])
      expect((await later.listCredited(U1, 10)).map((e) => e.recommendation_id).sort()).toEqual(['r_done', 'r_part'])
    })

    it('keeps events younger than 180 days', async () => {
      const t0 = 1_800_000_000_000
      await h.create(() => t0).addEvent(U1, event('a'))
      const later = h.create(() => t0 + 179 * DAY)
      await later.addEvent(U1, event('b'))
      expect((await later.listEvents(U1, 10)).length).toBe(2)
    })
  })

  describe('credited missions (the Meadow)', () => {
    it('lists only completed and partial missions, newest first, whatever else was recorded', async () => {
      await repo.addEvent(U1, event('a', { outcome: 'completed' }))
      await repo.addEvent(U1, event('b', { outcome: 'skipped' }))
      await repo.addEvent(U1, event('c', { outcome: 'partial' }))
      await repo.addEvent(U1, event('d', { outcome: 'pending' }))
      await repo.addEvent(U1, event('e', { outcome: 'changed' }))
      expect((await repo.listCredited(U1, 10)).map((e) => e.recommendation_id)).toEqual(['r_c', 'r_a'])
      expect(await repo.listCredited(U2, 10)).toEqual([])
    })

    it('respects the limit and keeps newest first', async () => {
      for (const id of ['1', '2', '3']) await repo.addEvent(U1, event(id, { outcome: 'completed' }))
      expect((await repo.listCredited(U1, 2)).map((e) => e.recommendation_id)).toEqual(['r_3', 'r_2'])
    })

    it('stores and returns minutes outside and side quests, and leaves them absent when unknown', async () => {
      await repo.addEvent(U1, event('x'))
      const before = await repo.getEvent(U1, 'r_x')
      expect(before).not.toHaveProperty('minutes_outside')
      expect(before).not.toHaveProperty('quests_done')
      await repo.updateEvent(U1, { ...before!, outcome: 'completed', minutes_outside: 37, quests_done: 2, context: { ...before!.context, planned_min: 40 } })
      const after = await repo.getEvent(U1, 'r_x')
      expect(after).toMatchObject({ minutes_outside: 37, quests_done: 2, context: { planned_min: 40 } })
      expect((await repo.listCredited(U1, 5))[0]).toMatchObject({ minutes_outside: 37, quests_done: 2 })
    })

    it('can record zero minutes and zero quests (0 is a value, not "missing")', async () => {
      await repo.addEvent(U1, event('z'))
      const e = (await repo.getEvent(U1, 'r_z'))!
      await repo.updateEvent(U1, { ...e, outcome: 'partial', minutes_outside: 0, quests_done: 0 })
      expect(await repo.getEvent(U1, 'r_z')).toMatchObject({ minutes_outside: 0, quests_done: 0 })
    })
  })

  describe('answered missions and the companion fields', () => {
    it('lists every answered mission (done, partial, skipped, swapped) and never an unanswered one, newest first', async () => {
      await repo.addEvent(U1, event('a', { outcome: 'completed' }))
      await repo.addEvent(U1, event('b', { outcome: 'pending' }))
      await repo.addEvent(U1, event('c', { outcome: 'skipped' }))
      await repo.addEvent(U1, event('d', { outcome: 'changed' }))
      await repo.addEvent(U1, event('e', { outcome: 'partial' }))
      expect((await repo.listAnswered(U1, 10)).map((e) => e.recommendation_id)).toEqual(['r_e', 'r_d', 'r_c', 'r_a'])
      expect((await repo.listAnswered(U1, 2)).map((e) => e.recommendation_id)).toEqual(['r_e', 'r_d'])
      expect(await repo.listAnswered(U2, 10)).toEqual([])
    })

    it('stores when they set off and what they told us afterwards, and returns it unchanged', async () => {
      await repo.addEvent(U1, event('x'))
      const e = (await repo.getEvent(U1, 'r_x'))!
      expect(e).not.toHaveProperty('started_at')
      expect(e).not.toHaveProperty('reflection')
      const reflection = { feeling: 'calmer', helper: 'noticing_things', barrier: 'too_tired', would_repeat: 'yes', note: 'Sitting felt easier than walking today.', has_photo: true, minutes_source: 'measured' } as const
      await repo.updateEvent(U1, { ...e, outcome: 'completed', started_at: '2026-10-07T12:00:00.000Z', reflection })
      expect(await repo.getEvent(U1, 'r_x')).toMatchObject({ started_at: '2026-10-07T12:00:00.000Z', reflection })
      expect((await repo.listAnswered(U1, 5))[0]).toMatchObject({ reflection })
    })

    it('replaces the reflection when the person corrects it, and clears it when they remove everything', async () => {
      await repo.addEvent(U1, event('y'))
      const e = (await repo.getEvent(U1, 'r_y'))!
      await repo.updateEvent(U1, { ...e, outcome: 'completed', reflection: { feeling: 'same', note: 'First thought.' } })
      await repo.updateEvent(U1, { ...(await repo.getEvent(U1, 'r_y'))!, reflection: { feeling: 'calmer' } })
      expect((await repo.getEvent(U1, 'r_y'))!.reflection).toEqual({ feeling: 'calmer' })
      const { reflection: _gone, ...without } = (await repo.getEvent(U1, 'r_y'))!
      await repo.updateEvent(U1, without)
      expect(await repo.getEvent(U1, 'r_y')).not.toHaveProperty('reflection')
    })

    it('keeps a note with quotes, emoji and non-latin text exactly as written (no injection, no mangling)', async () => {
      await repo.addEvent(U1, event('n'))
      const e = (await repo.getEvent(U1, 'r_n'))!
      const note = "It's \"lovely\" \\ ' ; DROP TABLE events; -- \u{1F33F} பூங்கா \n second line"
      await repo.updateEvent(U1, { ...e, outcome: 'completed', reflection: { note } })
      expect((await repo.getEvent(U1, 'r_n'))!.reflection?.note).toBe(note)
      expect((await repo.listEvents(U1, 5)).length).toBe(1)
    })

    it('counts the experiment arms across everyone without identifying anyone', async () => {
      const ctxFor = (flow?: 'companion' | 'classic') => ({ duration_limit: 30, mood: 'ok' as const, social_available: false, hour: 12, ...(flow ? { flow } : {}) })
      await repo.addEvent(U1, event('1', { outcome: 'completed', enjoyment: 5, context: ctxFor('companion') }))
      await repo.addEvent(U1, event('2', { outcome: 'skipped', context: ctxFor('companion') }))
      await repo.addEvent(U2, event('3', { outcome: 'completed', enjoyment: 3, context: ctxFor('classic') }))
      await repo.addEvent(U2, event('4', { outcome: 'pending', context: ctxFor('classic') }))
      await repo.addEvent(U2, event('5', { outcome: 'partial', context: ctxFor() })) // an older event with no flow counts as companion
      const e = (await repo.getEvent(U1, 'r_1'))!
      await repo.updateEvent(U1, { ...e, reflection: { would_repeat: 'yes', feeling: 'calmer' } })

      const stats = (await repo.flowStats()).sort((a, b) => (a.flow < b.flow ? -1 : 1))
      expect(stats).toEqual([
        { flow: 'classic', recommendations: 2, started: 1, full: 1, partial: 0, declined: 0, unanswered: 1, average_enjoyment: 3, would_repeat_yes: 0, with_reflection: 0 },
        { flow: 'companion', recommendations: 3, started: 2, full: 1, partial: 1, declined: 1, unanswered: 0, average_enjoyment: 5, would_repeat_yes: 1, with_reflection: 1 },
      ])
      expect(JSON.stringify(stats)).not.toMatch(/a{20}|b{20}|r_/) // no user keys, no recommendation ids
    })

    it('is empty when there is nothing to count', async () => {
      expect(await repo.flowStats()).toEqual([])
    })
  })

  describe.runIf(kind === 'd1')('companion fields (D1 only)', () => {
    it("shrugs off a reflection that cannot be read, instead of breaking the person's history", async () => {
      await repo.addEvent(U1, event('bad'))
      await h.rawExec?.("UPDATE events SET reflection = '{not json' WHERE recommendation_id = 'r_bad'")
      const e = await repo.getEvent(U1, 'r_bad')
      expect(e).not.toBeNull()
      expect(e).not.toHaveProperty('reflection')
    })
  })

  describe.runIf(kind === 'd1')('schema guards (D1)', () => {
    it('refuses out-of-range minutes or quests at the database level', async () => {
      await repo.addEvent(U1, event('m'))
      const e = (await repo.getEvent(U1, 'r_m'))!
      await expect(repo.updateEvent(U1, { ...e, minutes_outside: 9999 })).rejects.toThrow()
      await expect(repo.updateEvent(U1, { ...e, quests_done: 9 })).rejects.toThrow()
      await expect(repo.updateEvent(U1, { ...e, minutes_outside: -1 })).rejects.toThrow()
    })

    it('refuses an invalid outcome or out-of-range enjoyment at the database level', async () => {
      await expect(repo.addEvent(U1, event('1', { outcome: 'abandoned' as never }))).rejects.toThrow()
      await expect(repo.addEvent(U1, event('2', { outcome: 'completed', enjoyment: 9 }))).rejects.toThrow()
    })
  })
})
