import { describe, expect, it } from 'vitest'
import { ACTIVITIES, getActivity, planDeterministic, type Context, type UserProfile } from './index'
import { PROMPTS, alternativeFor, buildCompanion, buildSteps, companionNote, promptKind, splitMinutes } from './companion'

const ALL_GEAR = ['bicycle', 'racket', 'ball', 'swimwear', 'yoga_mat', 'sketchbook', 'cards', 'trash_bag'] as const
const profile = (over: Partial<UserProfile> = {}): UserProfile => ({
  user_id: 'u',
  preferences: { likes: [], dislikes: [], preferred_duration_min: 30, social_preference: 'any' },
  motivators: [],
  avoidances: [],
  equipment: [...ALL_GEAR],
  ...over,
})
const ctx = (over: Partial<Context> = {}): Context => ({ duration_limit: 60, social_available: true, mood: 'ok', hour: 12, weather: { category: 'clear', temp_c: 24 }, ...over })

describe('splitMinutes: the three phases always add up to the plan', () => {
  it('matches the document example (15 minutes = 3 + 8 + 4)', () => {
    expect(splitMinutes(15)).toEqual([3, 8, 4])
    expect(splitMinutes(5)).toEqual([1, 3, 1])
  })

  it('adds up to exactly the planned minutes for every plan, with no empty phase', () => {
    for (let p = 1; p <= 480; p++) {
      const parts = splitMinutes(p)
      expect(parts.reduce((a, b) => a + b, 0), `p=${p}`).toBe(p)
      for (const m of parts) expect(m, `p=${p}`).toBeGreaterThanOrEqual(1)
      expect(parts.length).toBeLessThanOrEqual(3)
    }
  })

  it('keeps a tiny mission as one step instead of inventing phases', () => {
    expect(splitMinutes(2)).toEqual([2])
    expect(splitMinutes(1)).toEqual([1])
  })
})

describe('buildSteps', () => {
  it('turns the Quiet Reset into the document\'s three steps', () => {
    const steps = buildSteps(getActivity('quiet_reset')!, 15)
    expect(steps.map((s) => s.minutes)).toEqual([3, 8, 4])
    expect(steps.map((s) => s.title)).toEqual(['Leave the noise behind', 'Let the mind wander', 'Return gently'])
    expect(steps[0]!.detail).toBe('Find a safe, nearby outdoor spot or another comfortable place with fresh air.')
    expect(steps[1]!.detail).toMatch(/one sound, one detail you hadn't noticed before, and one thing you find pleasant/)
    expect(steps[1]!.detail).toMatch(/Do not force a particular feeling/)
    expect(steps[2]!.detail).toMatch(/Notice whether anything feels different/)
  })

  it("starts every other mission with the activity's own first step", () => {
    for (const a of ACTIVITIES.filter((x) => x.id !== 'quiet_reset')) {
      const steps = buildSteps(a, Math.max(a.duration.min, 10))
      expect(steps[0]!.detail, a.id).toBe(a.firstStep)
      expect(steps.reduce((s, x) => s + x.minutes, 0), a.id).toBe(Math.max(a.duration.min, 10))
      for (const s of steps) {
        expect(s.title.length).toBeGreaterThan(3)
        expect(s.detail.length).toBeGreaterThan(10)
      }
    }
  })

  it('gives calm activities the calm titles and active ones the plain ones', () => {
    expect(buildSteps(getActivity('park_sit_and_watch')!, 20)[0]!.title).toBe('Leave the noise behind')
    expect(buildSteps(getActivity('easy_jog')!, 25)[0]!.title).toBe('Get going')
  })
})

describe('companionNote: built only from what the person said', () => {
  it('reproduces the document example for a low-energy, easy day', () => {
    const note = companionNote({ duration_limit: 15, mood: 'low', mode: 'minimum', desired_outcome: 'clear_head' })
    expect(note).toContain('You have 15 minutes and your energy is low.')
    expect(note).toContain('You want to clear your head.')
    expect(note).toContain("Let's keep it easy today.")
    expect(note).toContain('Give yourself permission to take it slowly.')
    expect(note).toContain('Your only commitment for now is the first two minutes.')
  })

  it('says nothing about energy or goals the person did not give', () => {
    const note = companionNote({ duration_limit: 40, mood: 'ok' })
    expect(note).not.toMatch(/energy|want to|drained|tired/i)
    expect(note).toContain('You have 40 minutes.')
  })

  it('handles a high-energy stretch day, and a single minute', () => {
    expect(companionNote({ duration_limit: 60, mood: 'high', mode: 'excellent' })).toMatch(/energy to spare.*make the most of it/)
    expect(companionNote({ duration_limit: 1, mood: 'ok' })).toContain('You have 1 minute.')
  })

  it('names each desired outcome plainly', () => {
    const words = { clear_head: 'clear your head', energise: 'feel more energetic', break_routine: 'break the routine', connect: 'feel connected' } as const
    for (const [outcome, phrase] of Object.entries(words)) {
      expect(companionNote({ duration_limit: 20, mood: 'ok', desired_outcome: outcome as keyof typeof words })).toContain(phrase)
    }
  })

  it('never judges or diagnoses', () => {
    for (const mood of ['low', 'ok', 'high'] as const) {
      for (const mode of ['minimum', 'normal', 'excellent'] as const) {
        expect(companionNote({ duration_limit: 30, mood, mode, desired_outcome: 'clear_head' })).not.toMatch(/should|must|lazy|fail|anxi|depress|stress/i)
      }
    }
  })
})

describe('the two-minute start and the indoor alternative', () => {
  it('every mission has a two-minute start that says it is enough', () => {
    for (const a of ACTIVITIES) {
      const c = buildCompanion(a, ctx(), a.duration.default)
      expect(c.tiny_start.minutes).toBe(2)
      expect(c.tiny_start.text, a.id).toMatch(/two minutes/i)
    }
  })

  it('offers the window or balcony version only when going out is hard, and only for activities that need outdoors', () => {
    const walk = getActivity('brisk_walk_loop')!
    expect(alternativeFor(walk, ctx())).toBeNull() // good weather, ok energy
    expect(alternativeFor(walk, ctx({ mood: 'low' }))).toMatch(/window|balcony/)
    expect(alternativeFor(walk, ctx({ mode: 'minimum' }))).toMatch(/window|balcony/)
    expect(alternativeFor(walk, ctx({ weather: { category: 'rain', temp_c: 20 } }))).toMatch(/window|balcony/)
    const indoors = getActivity('stretch_flow')! // already fine anywhere
    expect(alternativeFor(indoors, ctx({ mood: 'low' }))).toBeNull()
  })

  it('allows rest in the calm alternative', () => {
    expect(alternativeFor(getActivity('quiet_reset')!, ctx({ mood: 'low' }))).toMatch(/Resting is allowed/)
  })
})

describe('on every recommendation', () => {
  it('the steps add up to the planned duration, for every activity and every size of day', () => {
    for (const mode of ['minimum', 'normal', 'excellent'] as const) {
      for (const a of ACTIVITIES) {
        const { recommendation } = planDeterministic(profile({ preferences: { likes: [a.id], dislikes: [], preferred_duration_min: 30, social_preference: 'any' } }), ctx({ mode, duration_limit: 200 }), [])
        const total = recommendation.companion.steps.reduce((s, x) => s + x.minutes, 0)
        expect(total, `${recommendation.activity_id} ${mode}`).toBe(recommendation.duration_min)
      }
    }
  })

  it('the companion note reflects the real check-in', () => {
    const rec = planDeterministic(profile(), ctx({ duration_limit: 15, mood: 'low', mode: 'minimum', mode_cause: 'low_energy', desired_outcome: 'clear_head' }), []).recommendation
    expect(rec.companion.note).toContain('You have 15 minutes and your energy is low.')
    expect(rec.companion.note).toContain('clear your head')
  })
})

describe('prompts', () => {
  it('has a kind for every activity', () => {
    for (const a of ACTIVITIES) expect(Object.keys(PROMPTS)).toContain(promptKind(a.id))
  })
})
