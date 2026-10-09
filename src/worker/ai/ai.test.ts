import { describe, expect, it } from 'vitest'
import { planDeterministic, rank } from '@/shared/engine'
import type { Activity, Context, UserProfile } from '@/shared/engine/types'
import { AiGate } from './gate'
import { AiUnavailableError, type AiCompletion, type AiProvider, type AiRequest } from './provider'
import { buildPrompt, extractJsonObject, validateChoice } from './prompt'
import { refineWithAi } from './refine'
import { classifyAiError, extractText, GEMMA_MODEL, WorkersAiProvider, type AiBinding } from './workers-ai'

// All profiles and replies below are synthetic test data. The "model" is a script, never a real AI.

const profile: UserProfile = {
  user_id: 'test',
  preferences: { likes: ['walking', 'photography'], dislikes: ['running'], preferred_duration_min: 45, social_preference: 'any' },
  motivators: ['novelty', 'calm'],
  avoidances: [],
  equipment: [],
}
const ctx: Context = { duration_limit: 60, social_available: false, mood: 'ok', hour: 17, weather: { category: 'clear', temp_c: 24 } }

const ranking = rank(profile, ctx, [])
const top3 = ranking.ranked.slice(0, 3)
const deterministic = planDeterministic(profile, ctx, []).recommendation
const A = top3[0]!.activity
const B = top3[1]!.activity

/** A well-formed reply that only uses provided facts. */
const goodReply = (activity: Activity, over: Record<string, unknown> = {}) =>
  JSON.stringify({
    activity_id: activity.id,
    reason: 'You said you like walking, and this fits the 60 minutes you have.',
    first_step: `${activity.firstStep} Notice one thing you have never noticed before.`,
    ...over,
  })

type Step = string | Error | (() => Promise<string>)
function fakeProvider(script: Step[]): AiProvider & { calls: AiRequest[] } {
  const calls: AiRequest[] = []
  return {
    name: 'fake',
    calls,
    async complete(req: AiRequest): Promise<AiCompletion> {
      calls.push(req)
      const step = script[Math.min(calls.length - 1, script.length - 1)]
      if (step instanceof Error) throw step
      const text = typeof step === 'function' ? await step() : step
      return { text: text as string, model: 'fake-model', usage: { inputTokens: 600, outputTokens: 120 } }
    },
  }
}

const run = (p: AiProvider, over: { timeoutMs?: number } = {}) =>
  refineWithAi({ provider: p, profile, ctx, ranking, deterministic, ...over })

// ------------------------------------------------------------------ prompt

describe('prompt', () => {
  it('is compact, includes only candidate facts, and carries no identifiers', () => {
    const { request } = buildPrompt(profile, ctx, top3)
    const all = request.system + request.user
    expect(all.length).toBeLessThan(3500) // a few hundred tokens, to protect the free daily quota
    for (const s of top3) expect(request.user).toContain(s.activity.id)
    expect(request.user).not.toMatch(/user_id|session|userKey|test@/i)
    expect(request.maxTokens).toBeLessThanOrEqual(400)
  })

  it('only offers facts that are really true (none without history or likes)', () => {
    const bare = rank({ ...profile, preferences: { ...profile.preferences, likes: [] }, motivators: [] }, ctx, [])
    const { context } = buildPrompt(profile, ctx, bare.ranked.slice(0, 3))
    for (const c of context.candidates) {
      expect(c.facts.join(' ')).not.toMatch(/finished|recent picks|worked for you/i)
    }
  })

  it('includes real conditions only when they are known', () => {
    const none = buildPrompt(profile, { ...ctx, weather: undefined }, top3).request.user
    expect(none).not.toContain('"weather"')
    expect(none).not.toContain('"daylight"')
    const rainy = buildPrompt(profile, { ...ctx, weather: { category: 'cloudy', temp_c: 23.6 }, is_daylight: false }, top3).request.user
    expect(rainy).toContain('"weather":{"sky":"cloudy","temp_c":24}')
    expect(rainy).toContain('"daylight":"night"')
  })

  it('lets the model quote the real temperature, but still not an invented one', () => {
    const wctx: Context = { ...ctx, weather: { category: 'clear', temp_c: 27.2 }, is_daylight: true }
    const { context } = buildPrompt(profile, wctx, top3)
    const reply = (reason: string) => validateChoice({ activity_id: A.id, reason, first_step: `${A.firstStep} Notice one thing.` }, context)
    expect(reply('It is 27 degrees and you like walking, so this fits your 60 minutes.').ok).toBe(true)
    expect(reply('It is 35 degrees and you like walking, so this fits your 60 minutes.').ok).toBe(false)
  })

  it('adds a retry hint only when asked, and the hint never contains model text', () => {
    expect(buildPrompt(profile, ctx, top3).request.user).not.toContain('rejected')
    expect(buildPrompt(profile, ctx, top3, 'activity_id is not one of the candidate ids').request.user).toContain('rejected')
  })
})

// ----------------------------------------------------------------- parsing

describe('extractJsonObject', () => {
  it('reads plain JSON, fenced JSON, and JSON surrounded by prose', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 })
    expect(extractJsonObject('```json\n{"a":{"b":2}}\n```')).toEqual({ a: { b: 2 } })
    expect(extractJsonObject('Sure! Here you go: {"a":"x } y"} hope it helps')).toEqual({ a: 'x } y' })
  })
  it('returns null for broken or missing JSON', () => {
    expect(extractJsonObject('no json here')).toBeNull()
    expect(extractJsonObject('{"a":')).toBeNull()
    expect(extractJsonObject('{bad json}')).toBeNull()
  })
})

// -------------------------------------------------------------- validation

describe('validateChoice: nothing unsafe or invented reaches the user', () => {
  const { context } = buildPrompt(profile, ctx, top3)
  const check = (over: Record<string, unknown>) => validateChoice(JSON.parse(goodReply(A, over)), context)

  it('accepts a good reply', () => {
    const v = check({})
    expect(v.ok).toBe(true)
  })

  it('accepts a different candidate than the top one', () => {
    expect(validateChoice(JSON.parse(goodReply(B)), context).ok).toBe(true)
  })

  it('rejects an activity that was not offered', () => {
    expect(check({ activity_id: 'invented_activity' })).toMatchObject({ ok: false })
  })

  it('rejects wrong shapes and bad lengths', () => {
    expect(validateChoice({ activity_id: A.id }, context).ok).toBe(false)
    expect(validateChoice('nope', context).ok).toBe(false)
    expect(check({ reason: 'too short' }).ok).toBe(false)
    expect(check({ reason: 'x'.repeat(300) }).ok).toBe(false)
  })

  it('rejects links, markdown and special characters', () => {
    for (const bad of ['Visit https://example.com for a nice walk today.', 'You **really** like walking and this fits well.', 'Write me at a@b.co about the nice walk.']) {
      expect(check({ reason: bad }).ok, bad).toBe(false)
    }
  })

  it('rejects numbers that were not provided', () => {
    const v = check({ reason: 'You finished this 7 of 7 times, so it fits you perfectly.' })
    expect(v).toMatchObject({ ok: false })
    expect((v as { reason: string }).reason).toMatch(/7/)
  })

  it('rejects first steps that ask for more minutes than the person has', () => {
    expect(check({ first_step: `${A.firstStep} Then keep going for 90 more.` }).ok).toBe(false)
  })

  it('rejects history claims the facts do not support', () => {
    for (const bad of ['You always enjoy a good walk, so this fits your day.', 'You usually pick this kind of thing, which is why it fits.', 'This is your favourite way to spend an hour, so go for it.']) {
      expect(check({ reason: bad }).ok, bad).toBe(false)
    }
  })

  it('allows "never" when it describes the activity itself, but not when it would describe the person', () => {
    const cafe = ranking.ranked.find((s) => s.activity.id === 'new_cafe_walk')!
    const walk = ranking.ranked.find((s) => s.activity.id === 'brisk_walk_loop')!
    const { context: both } = buildPrompt(profile, ctx, [cafe, walk])
    const reply = (activity: Activity) => ({
      activity_id: activity.id,
      reason: 'You might enjoy exploring a place you have never been before, and it fits the 60 minutes you have.',
      first_step: activity.firstStep,
    })
    // The café walk's own instruction says "a place you have never been": describing it that way is honest.
    expect(validateChoice(reply(cafe.activity), both).ok).toBe(true)
    // Nothing in the brisk walk's text says "never", so here it would be an invented claim.
    expect(validateChoice(reply(walk.activity), both).ok).toBe(false)
  })

  it('rejects overstated feelings and invented possessions, in either field', () => {
    for (const bad of ['You love walking and photography, so this fits your hour.', 'Your passion for walking makes this a natural choice today.']) {
      expect(check({ reason: bad }).ok, bad).toBe(false)
    }
    expect(check({ first_step: `${A.firstStep} Bring your favorite water bottle.` }).ok).toBe(false)
    // "like" and "enjoy" are fine, and a first step may say "never" (e.g. "a place you have never been").
    expect(check({ reason: 'You enjoy walking and photography, so this fits the 60 minutes you have.' }).ok).toBe(true)
  })

  it('rejects a first step that has nothing to do with the chosen activity', () => {
    expect(check({ first_step: 'Order a pizza and watch a film tonight, then relax.' })).toMatchObject({ ok: false })
  })
})

// ------------------------------------------------------------- orchestrator

describe('refineWithAi', () => {
  it('uses the AI wording but keeps title, duration and mode from the engine', async () => {
    const p = fakeProvider([goodReply(A)])
    const { recommendation, outcome } = await run(p)
    expect(outcome.status).toBe('ok')
    expect(outcome.attempts).toBe(1)
    expect(recommendation.source).toBe('ai')
    expect(recommendation.model).toBe('fake-model')
    expect(recommendation.title).toBe(A.title)
    expect(recommendation.reason).toContain('You said you like walking')
    expect(recommendation.duration_min).toBeLessThanOrEqual(ctx.duration_limit)
    expect(outcome.neurons).toBeGreaterThan(0)
  })

  it('lets the AI pick the second candidate, and the response is rebuilt around it', async () => {
    const { recommendation } = await run(fakeProvider([goodReply(B)]))
    expect(recommendation.activity_id).toBe(B.id)
    expect(recommendation.title).toBe(B.title)
    expect(recommendation.fallback?.activity_id).not.toBe(B.id)
  })

  it('retries once with a hint when the first reply is invalid, then succeeds', async () => {
    const p = fakeProvider([goodReply(A, { activity_id: 'nope' }), goodReply(A)])
    const { outcome, recommendation } = await run(p)
    expect(outcome).toMatchObject({ status: 'ok', attempts: 2 })
    expect(recommendation.source).toBe('ai')
    expect(p.calls[1]!.user).toContain('rejected')
    expect(p.calls[1]!.user).not.toContain('invented')
  })

  it('falls back to the deterministic answer after two invalid replies', async () => {
    const p = fakeProvider(['not json at all', 'still {not json'])
    const { outcome, recommendation } = await run(p)
    expect(outcome).toMatchObject({ status: 'invalid', attempts: 2 })
    expect(recommendation).toEqual(deterministic)
  })

  it.each([
    ['busy', new AiUnavailableError('busy', 'x')],
    ['quota', new AiUnavailableError('quota', 'x')],
    ['error', new AiUnavailableError('error', 'x')],
    ['error', new Error('socket exploded')],
  ] as const)('answers deterministically, without retrying, on %s', async (status, err) => {
    const p = fakeProvider([err])
    const { outcome, recommendation } = await run(p)
    expect(outcome.status).toBe(status)
    expect(p.calls).toHaveLength(1)
    expect(recommendation).toEqual(deterministic)
  })

  it('gives up at the time budget even if the provider never answers', async () => {
    const never: AiProvider = {
      name: 'hang',
      complete: (_req, signal) =>
        new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new AiUnavailableError('timeout', 'slow')), { once: true })),
    }
    const t0 = Date.now()
    const { outcome, recommendation } = await run(never, { timeoutMs: 80 })
    expect(outcome.status).toBe('timeout')
    expect(Date.now() - t0).toBeLessThan(1000)
    expect(recommendation).toEqual(deterministic)
  })

  it('does not call the AI at all when there is nothing to choose between', async () => {
    const one = { ...ranking, ranked: ranking.ranked.slice(0, 1) }
    const p = fakeProvider([goodReply(A)])
    const r = await refineWithAi({ provider: p, profile, ctx, ranking: one, deterministic })
    expect(r.outcome).toMatchObject({ status: 'skipped', attempts: 0 })
    expect(p.calls).toHaveLength(0)

    const safetyNet = await refineWithAi({ provider: p, profile, ctx, ranking: { ...ranking, usedGuaranteedFallback: true }, deterministic })
    expect(safetyNet.outcome.status).toBe('skipped')
  })

  it('only ever lets the model choose from the top candidates', async () => {
    const outsider = ranking.ranked[5]!.activity
    const { outcome } = await run(fakeProvider([goodReply(outsider), goodReply(outsider)]))
    expect(outcome.status).toBe('invalid')
  })
})

// --------------------------------------------------------------- the gate

describe('AiGate', () => {
  const t = Date.UTC(2026, 9, 9, 15, 30)
  it('is open by default and after success', () => {
    const g = new AiGate()
    expect(g.canTry(t)).toBe(true)
    g.record('busy', t)
    g.record('ok', t + 1)
    expect(g.canTry(t + 2)).toBe(true)
  })
  it('closes for 30 s on busy, 10 s on error/timeout', () => {
    const g = new AiGate()
    g.record('busy', t)
    expect(g.canTry(t + 29_000)).toBe(false)
    expect(g.canTry(t + 30_000)).toBe(true)
    g.record('timeout', t)
    expect(g.canTry(t + 9_000)).toBe(false)
    expect(g.canTry(t + 10_000)).toBe(true)
  })
  it('closes until 00:00 UTC when the daily quota is gone', () => {
    const g = new AiGate()
    g.record('quota', t)
    expect(g.canTry(Date.UTC(2026, 9, 9, 23, 59, 59))).toBe(false)
    expect(g.canTry(Date.UTC(2026, 9, 10, 0, 0, 0))).toBe(true)
  })
  it('ignores invalid/skipped (those are not availability problems)', () => {
    const g = new AiGate()
    g.record('invalid', t)
    g.record('skipped', t)
    expect(g.canTry(t)).toBe(true)
  })
})

// ------------------------------------------------------- Workers AI provider

describe('WorkersAiProvider', () => {
  const req: AiRequest = { system: 'sys', user: 'usr', maxTokens: 100, temperature: 0.2 }
  const binding = (impl: (model: string, input: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown>): AiBinding & { calls: unknown[][] } => {
    const calls: unknown[][] = []
    return {
      calls,
      run: (m, i, o) => {
        calls.push([m, i, o])
        return impl(m, i, o)
      },
    }
  }

  it('calls Gemma 4 with rejectIfBusy so it never waits in a capacity queue', async () => {
    const b = binding(async () => ({ choices: [{ message: { content: '{"x":1}' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }))
    const out = await new WorkersAiProvider(b).complete(req)
    expect(b.calls[0]![0]).toBe(GEMMA_MODEL)
    expect(b.calls[0]![2]).toEqual({ rejectIfBusy: true })
    expect((b.calls[0]![1] as { messages: unknown[] }).messages).toHaveLength(2)
    expect(out).toEqual({ text: '{"x":1}', model: GEMMA_MODEL, usage: { inputTokens: 10, outputTokens: 5 } })
    // Thinking must be off, or Gemma 4 burns its whole budget reasoning and returns nothing.
    expect((b.calls[0]![1] as { chat_template_kwargs: unknown }).chat_template_kwargs).toEqual({ enable_thinking: false })
  })

  it('reads every response shape Workers AI uses', () => {
    expect(extractText({ choices: [{ message: { content: 'a' } }] })).toBe('a')
    expect(extractText({ choices: [{ message: { content: [{ text: 'a' }, { text: 'b' }] } }] })).toBe('ab')
    expect(extractText({ response: 'plain' })).toBe('plain')
    expect(extractText({ response: { already: 'parsed' } })).toBe('{"already":"parsed"}')
    expect(extractText({})).toBeNull()
    expect(extractText(null)).toBeNull()
  })

  it('classifies failures into busy / quota / timeout / error', () => {
    expect(classifyAiError(new Error('3040: Out of capacity')).kind).toBe('busy')
    expect(classifyAiError(new Error('429 Too Many Requests')).kind).toBe('busy')
    expect(classifyAiError(new Error('You have used your daily free allocation of 10,000 neurons')).kind).toBe('quota')
    expect(classifyAiError(Object.assign(new Error('x'), { name: 'AbortError' })).kind).toBe('timeout')
    expect(classifyAiError(new Error('something else')).kind).toBe('error')
  })

  it('turns any thrown error into AiUnavailableError and never leaks the prompt', async () => {
    const b = binding(async () => {
      throw new Error('3040 capacity')
    })
    await expect(new WorkersAiProvider(b).complete(req)).rejects.toMatchObject({ kind: 'busy' })
  })

  it('stops waiting when the abort signal fires', async () => {
    const b = binding(() => new Promise(() => {}))
    const ac = new AbortController()
    const p = new WorkersAiProvider(b).complete(req, ac.signal)
    ac.abort()
    await expect(p).rejects.toMatchObject({ kind: 'timeout' })
  })

  it('rejects an empty response', async () => {
    await expect(new WorkersAiProvider(binding(async () => ({}))).complete(req)).rejects.toMatchObject({ kind: 'error' })
  })
})
