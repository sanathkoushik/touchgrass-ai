import { describe, expect, it } from 'vitest'
import type { ApiErrorBody, HistoryResponse, RecommendResponse, UpgradeResponse } from '@/shared/api'
import { getActivity } from '@/shared/engine'
import { createApp } from '../app'
import { MemoryRepository } from '../repository'
import { AiGate } from './gate'
import { AiUnavailableError, type AiCompletion, type AiProvider, type AiRequest } from './provider'

// Synthetic users and a scripted "AI". Nothing here talks to a real model.

const SESSION = '3f2b8c1e-5d4a-4b7e-9c6d-1a2b3c4d5e6f'
const OTHER_SESSION = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'
const PROFILE = {
  preferences: { likes: ['walking', 'photography'], dislikes: ['running'], preferred_duration_min: 45, social_preference: 'any' },
  motivators: ['novelty', 'calm'],
  avoidances: [],
  equipment: [],
  best_windows: [],
}

/** Builds a reply for whichever candidate ids appear in the prompt the app actually sent. */
function replyFromPrompt(req: AiRequest, pickIndex = 0): string {
  const payload = JSON.parse(req.user.split('\n')[0]!) as { candidates: { id: string }[] }
  const id = payload.candidates[pickIndex]!.id
  const activity = getActivity(id)!
  return JSON.stringify({
    activity_id: id,
    reason: 'You said you like walking, and this fits the 60 minutes you have.',
    first_step: `${activity.firstStep} Notice one thing you have never noticed before.`,
  })
}

type Behaviour = (req: AiRequest, call: number) => string | Error
function scripted(behaviour: Behaviour): AiProvider & { calls: AiRequest[] } {
  const calls: AiRequest[] = []
  return {
    name: 'scripted',
    calls,
    async complete(req): Promise<AiCompletion> {
      calls.push(req)
      const out = behaviour(req, calls.length)
      if (out instanceof Error) throw out
      return { text: out, model: 'scripted-model', usage: { inputTokens: 500, outputTokens: 100 } }
    },
  }
}

function setup(provider: AiProvider | null, clock: { t: number } = { t: Date.UTC(2026, 9, 9, 12, 0) }, gate = new AiGate()) {
  const app = createApp({
    repo: new MemoryRepository(),
    now: () => new Date(clock.t),
    ai: { provider: () => provider, gate, timeoutMs: 500 },
  })
  const call = async <T>(method: string, path: string, body?: unknown, session: string = SESSION) => {
    const res = await app.request(path, {
      method,
      headers: { 'x-session-id': session, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: res.status, json: (await res.json()) as T }
  }
  return { call, gate, clock }
}

const onboardAnd = async (s: ReturnType<typeof setup>) => {
  await s.call('POST', '/api/onboarding', PROFILE)
  return s
}
const recommend = (s: ReturnType<typeof setup>, over: Record<string, unknown> = {}) =>
  s.call<RecommendResponse>('POST', '/api/recommend', { duration_limit: 60, ...over })

describe('POST /api/recommend with an AI available', () => {
  it('returns the AI wording, marked as such, and stores the activity the AI chose', async () => {
    const ai = scripted((req) => replyFromPrompt(req, 1)) // choose the SECOND candidate
    const s = await onboardAnd(setup(ai))
    const r = await recommend(s)
    expect(r.status).toBe(200)
    expect(r.json.source).toBe('ai')
    expect(r.json.model).toBe('scripted-model')
    expect(r.json.reason).toContain('You said you like walking')
    expect(r.json.persisted).toBe(true)
    // Title and duration still come from the catalog, never from the model.
    expect(r.json.title).toBe(getActivity(r.json.activity_id)!.title)
    expect(r.json.duration_min).toBeLessThanOrEqual(60)

    const hist = await s.call<HistoryResponse>('GET', '/api/history')
    expect(hist.json.items[0]?.activity_id).toBe(r.json.activity_id)
  })

  it('sends the model only compact, anonymous information', async () => {
    const ai = scripted((req) => replyFromPrompt(req))
    const s = await onboardAnd(setup(ai))
    await recommend(s)
    const sent = ai.calls[0]!.system + ai.calls[0]!.user
    expect(sent).not.toContain(SESSION)
    expect(sent).not.toMatch(/user_id|x-session-id|userKey/i)
    expect(sent.length).toBeLessThan(3500)
  })

  it('skips the AI entirely when the client opts out', async () => {
    const ai = scripted((req) => replyFromPrompt(req))
    const s = await onboardAnd(setup(ai))
    const r = await recommend(s, { use_ai: false })
    expect(r.json.source).toBe('deterministic')
    expect(ai.calls).toHaveLength(0)
  })

  it('works with no AI configured at all', async () => {
    const s = await onboardAnd(setup(null))
    const r = await recommend(s)
    expect(r.status).toBe(200)
    expect(r.json.source).toBe('deterministic')
  })

  it('lets the user give feedback on an AI recommendation like any other', async () => {
    const s = await onboardAnd(setup(scripted((req) => replyFromPrompt(req))))
    const r = await recommend(s)
    const fb = await s.call('POST', '/api/feedback', { recommendation_id: r.json.recommendation_id, outcome: 'completed', enjoyment: 5 })
    expect(fb.status).toBe(200)
  })
})

describe('when the AI misbehaves, the user never notices', () => {
  const failures: [string, Behaviour][] = [
    ['returns garbage', () => 'I am sorry, I cannot do that.'],
    ['invents an activity', () => JSON.stringify({ activity_id: 'skydiving', reason: 'You said you like walking, so jump.', first_step: 'Jump out of a plane today.' })],
    ['throws busy', () => new AiUnavailableError('busy', 'out of capacity')],
    ['throws quota', () => new AiUnavailableError('quota', 'daily allocation used')],
    ['throws an unexpected error', () => new Error('mongodb://user:secret@host exploded')],
  ]
  it.each(failures)('still answers 200 with the deterministic pick when the AI %s', async (_name, behaviour) => {
    const s = await onboardAnd(setup(scripted(behaviour)))
    const r = await recommend(s)
    expect(r.status).toBe(200)
    expect(r.json.source).toBe('deterministic')
    expect(r.json.title.length).toBeGreaterThan(3)
    expect(JSON.stringify(r.json)).not.toContain('secret')
    expect(JSON.stringify(r.json)).not.toContain('sorry')
  })

  it('stops calling a failing AI for a while, then tries again', async () => {
    const clock = { t: Date.UTC(2026, 9, 9, 12, 0) }
    const ai = scripted(() => new AiUnavailableError('busy', 'out of capacity'))
    const s = await onboardAnd(setup(ai, clock))

    await recommend(s)
    expect(ai.calls).toHaveLength(1)
    await recommend(s) // within 30 s: skipped, answered instantly
    expect(ai.calls).toHaveLength(1)

    clock.t += 31_000
    await recommend(s)
    expect(ai.calls).toHaveLength(2)
  })

  it('stays off until 00:00 UTC after the daily quota is used up', async () => {
    const clock = { t: Date.UTC(2026, 9, 9, 12, 0) }
    const ai = scripted(() => new AiUnavailableError('quota', 'daily allocation used'))
    const s = await onboardAnd(setup(ai, clock))
    await recommend(s)
    clock.t = Date.UTC(2026, 9, 9, 23, 59)
    await recommend(s)
    expect(ai.calls).toHaveLength(1)
    clock.t = Date.UTC(2026, 9, 10, 0, 1)
    await recommend(s)
    expect(ai.calls).toHaveLength(2)
  })

  it('does not wait forever for a hung AI', async () => {
    const hung: AiProvider = {
      name: 'hung',
      complete: (_r, signal) => new Promise((_, rej) => signal?.addEventListener('abort', () => rej(new AiUnavailableError('timeout', 'slow')), { once: true })),
    }
    const s = await onboardAnd(setup(hung))
    const t0 = Date.now()
    const r = await recommend(s)
    expect(r.json.source).toBe('deterministic')
    expect(Date.now() - t0).toBeLessThan(2500) // timeoutMs is 500 in these tests
  })

  it('validates use_ai like any other field', async () => {
    const s = await onboardAnd(setup(null))
    const r = await s.call<ApiErrorBody>('POST', '/api/recommend', { duration_limit: 60, use_ai: 'yes' })
    expect(r.status).toBe(400)
  })
})

// ------------------------------------------------- engine pick first, AI upgrade second

describe('POST /api/recommend/:id/upgrade', () => {
  const quick = (s: ReturnType<typeof setup>) => recommend(s, { use_ai: false })
  const upgrade = (s: ReturnType<typeof setup>, id: string, session?: string) =>
    s.call<UpgradeResponse & Partial<ApiErrorBody>>('POST', `/api/recommend/${id}/upgrade`, undefined, session)

  it('first answers instantly from the engine, then upgrades the SAME recommendation with the AI', async () => {
    const ai = scripted((req) => replyFromPrompt(req))
    const s = await onboardAnd(setup(ai))
    const first = await quick(s)
    expect(first.json.source).toBe('deterministic')
    expect(ai.calls).toHaveLength(0) // nothing waited on the AI

    const up = await upgrade(s, first.json.recommendation_id)
    expect(up.status).toBe(200)
    expect(up.json.upgraded).toBe(true)
    expect(up.json.recommendation?.recommendation_id).toBe(first.json.recommendation_id)
    expect(up.json.recommendation?.source).toBe('ai')
    expect(up.json.recommendation?.reason).toContain('You said you like walking')
    expect(ai.calls).toHaveLength(1)
  })

  it('records the AI-chosen activity when it differs from the engine pick, so feedback and history agree with the screen', async () => {
    const s = await onboardAnd(setup(scripted((req) => replyFromPrompt(req, 1))))
    const first = await quick(s)
    const up = await upgrade(s, first.json.recommendation_id)
    const chosen = up.json.recommendation!.activity_id
    expect(chosen).not.toBe(first.json.activity_id)

    const hist = await s.call<HistoryResponse>('GET', '/api/history')
    expect(hist.json.items).toHaveLength(1) // upgraded in place, not duplicated
    expect(hist.json.items[0]).toMatchObject({ recommendation_id: first.json.recommendation_id, activity_id: chosen, outcome: 'pending' })

    const fb = await s.call('POST', '/api/feedback', { recommendation_id: first.json.recommendation_id, outcome: 'completed', enjoyment: 5 })
    expect(fb.status).toBe(200)
  })

  it('allows only ONE upgrade attempt per recommendation, so retries cannot burn the free quota', async () => {
    const ai = scripted((req) => replyFromPrompt(req))
    const s = await onboardAnd(setup(ai))
    const first = await quick(s)
    await upgrade(s, first.json.recommendation_id)
    const again = await upgrade(s, first.json.recommendation_id)
    expect(again.json).toEqual({ upgraded: false, reason: 'already_attempted' })
    expect(ai.calls).toHaveLength(1)
  })

  it('a failed attempt also counts, and the screen simply keeps the engine pick', async () => {
    const ai = scripted(() => 'not json')
    const s = await onboardAnd(setup(ai))
    const first = await quick(s)
    const up = await upgrade(s, first.json.recommendation_id)
    expect(up.status).toBe(200)
    expect(up.json).toEqual({ upgraded: false, reason: 'ai_failed' })
    expect((await upgrade(s, first.json.recommendation_id)).json.reason).toBe('already_attempted')
    const hist = await s.call<HistoryResponse>('GET', '/api/history')
    expect(hist.json.items[0]?.activity_id).toBe(first.json.activity_id) // unchanged
  })

  it('says "ai_unavailable" instantly when there is no AI, without marking the recommendation as tried', async () => {
    const s = await onboardAnd(setup(null))
    const first = await quick(s)
    const t0 = Date.now()
    const up = await upgrade(s, first.json.recommendation_id)
    expect(up.json).toEqual({ upgraded: false, reason: 'ai_unavailable' })
    expect(Date.now() - t0).toBeLessThan(500)
  })

  it('does not call a struggling AI: after a busy signal other recommendations get "ai_cooling_down" immediately', async () => {
    const ai = scripted(() => new AiUnavailableError('busy', 'out of capacity'))
    const s = await onboardAnd(setup(ai))
    const a = await quick(s)
    const b = await quick(s)
    expect((await upgrade(s, a.json.recommendation_id)).json.reason).toBe('ai_failed')
    expect((await upgrade(s, b.json.recommendation_id)).json.reason).toBe('ai_cooling_down')
    expect(ai.calls).toHaveLength(1)
  })

  it('never rewrites an answered recommendation', async () => {
    const ai = scripted((req) => replyFromPrompt(req))
    const s = await onboardAnd(setup(ai))
    const first = await quick(s)
    await s.call('POST', '/api/feedback', { recommendation_id: first.json.recommendation_id, outcome: 'skipped', skip_reason: 'boring' })
    const up = await upgrade(s, first.json.recommendation_id)
    expect(up.status).toBe(409)
    expect(up.json.error?.code).toBe('already_answered')
    expect(ai.calls).toHaveLength(0)
  })

  it('is private to the session, and validates the id', async () => {
    const ai = scripted((req) => replyFromPrompt(req))
    const s = await onboardAnd(setup(ai))
    const first = await quick(s)
    const stolen = await upgrade(s, first.json.recommendation_id, OTHER_SESSION)
    expect(stolen.status).toBe(404)
    expect(ai.calls).toHaveLength(0)
    expect((await upgrade(s, 'r_nope')).status).toBe(400)
    expect((await upgrade(s, `r_${crypto.randomUUID()}`)).status).toBe(404)
  })

  it('shows a timed-out AI as a normal "not upgraded" answer within the time budget', async () => {
    const hung: AiProvider = {
      name: 'hung',
      complete: (_r, signal) => new Promise((_, rej) => signal?.addEventListener('abort', () => rej(new AiUnavailableError('timeout', 'slow')), { once: true })),
    }
    const s = await onboardAnd(setup(hung))
    const first = await quick(s)
    const t0 = Date.now()
    const up = await upgrade(s, first.json.recommendation_id)
    expect(up.json).toEqual({ upgraded: false, reason: 'ai_failed' })
    expect(Date.now() - t0).toBeLessThan(2500) // timeoutMs is 500 in these tests
  })
})
