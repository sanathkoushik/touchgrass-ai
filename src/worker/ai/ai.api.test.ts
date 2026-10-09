import { describe, expect, it } from 'vitest'
import type { ApiErrorBody, HistoryResponse, RecommendResponse } from '@/shared/api'
import { getActivity } from '@/shared/engine'
import { createApp } from '../app'
import { MemoryRepository } from '../repository'
import { AiGate } from './gate'
import { AiUnavailableError, type AiCompletion, type AiProvider, type AiRequest } from './provider'

// Synthetic users and a scripted "AI". Nothing here talks to a real model.

const SESSION = '3f2b8c1e-5d4a-4b7e-9c6d-1a2b3c4d5e6f'
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
  const call = async <T>(method: string, path: string, body?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: { 'x-session-id': SESSION, 'content-type': 'application/json' },
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
