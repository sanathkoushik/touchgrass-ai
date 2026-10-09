import { writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { planDeterministic, rank } from '../src/shared/engine'
import type { Context, HistoryEvent, UserProfile } from '../src/shared/engine/types'
import type { AiCompletion, AiProvider, AiRequest } from '../src/worker/ai/provider'
import { buildPrompt, extractJsonObject, validateChoice } from '../src/worker/ai/prompt'
import { refineWithAi, type AiOutcome } from '../src/worker/ai/refine'
import { GEMMA_MODEL, WorkersAiProvider, type AiBinding } from '../src/worker/ai/workers-ai'

/**
 * MANUAL, REAL-MODEL CHECK. Calls the real Gemma 4 on Cloudflare, so it needs `wrangler login` and spends the
 * free daily Neuron quota. Never part of `npm test`. Run:  npm run test:live
 *   TG_LIVE_N=1   how many of the 20 scenarios to run (default 20)
 *   TG_LIVE_OUT   where to write the detailed report (JSON)
 * All profiles are synthetic. Raw model replies are written to the report for diagnosis only.
 */

const N = Number(process.env.TG_LIVE_N ?? 20)
/** Only run scenarios whose name contains this text (e.g. TG_LIVE_ONLY=22:00). */
const ONLY = process.env.TG_LIVE_ONLY
/** Repeat each selected scenario this many times (to measure variability). */
const REPEAT = Number(process.env.TG_LIVE_REPEAT ?? 1)
const OUT = process.env.TG_LIVE_OUT ?? 'live-report.json'

const profile = (over: Partial<UserProfile> & { likes?: string[]; dislikes?: string[]; dur?: number; social?: UserProfile['preferences']['social_preference'] }): UserProfile => ({
  user_id: 'live',
  preferences: {
    likes: over.likes ?? [],
    dislikes: over.dislikes ?? [],
    preferred_duration_min: over.dur ?? 45,
    social_preference: over.social ?? 'any',
  },
  motivators: over.motivators ?? [],
  avoidances: over.avoidances ?? [],
  equipment: over.equipment ?? [],
})

const walker = profile({ likes: ['walking', 'photography'], dislikes: ['running'], motivators: ['novelty', 'calm'] })
const athlete = profile({ likes: ['badminton', 'football'], motivators: ['social', 'competition'], social: 'small_group', equipment: ['racket', 'ball'], dur: 60 })
const creative = profile({ likes: ['drawing', 'photography'], motivators: ['creativity', 'calm'], social: 'solo', equipment: ['sketchbook'], dur: 40 })
const explorer = profile({ likes: ['hiking', 'exploring', 'cafe'], motivators: ['exploration', 'novelty', 'food'], dur: 90, equipment: ['bicycle'] })
const homebody = profile({ likes: ['yoga', 'music'], dislikes: ['swimming', 'cycling'], motivators: ['calm', 'music'], social: 'solo', dur: 20 })

const T = (d: number, h = 17) => `2026-09-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:30:00+05:30`
const ev = (id: string, outcome: HistoryEvent['outcome'], d: number, extra: Partial<HistoryEvent> = {}): HistoryEvent => ({ activity_id: id, timestamp: T(d), outcome, ...extra })

const ctx = (over: Partial<Context>): Context => ({ duration_limit: 45, social_available: false, mood: 'ok', hour: 17, weather: { category: 'clear', temp_c: 26 }, ...over })

interface Scenario {
  name: string
  profile: UserProfile
  ctx: Context
  history: HistoryEvent[]
}

const SCENARIOS: Scenario[] = [
  { name: 'walker, evening, 60 min', profile: walker, ctx: ctx({ duration_limit: 60 }), history: [] },
  { name: 'walker, low energy, 20 min', profile: walker, ctx: ctx({ duration_limit: 20, mood: 'low' }), history: [] },
  { name: 'athlete with friend free', profile: athlete, ctx: ctx({ duration_limit: 75, social_available: true }), history: [] },
  { name: 'athlete, nobody free', profile: athlete, ctx: ctx({ duration_limit: 45 }), history: [] },
  { name: 'creative, solo, afternoon', profile: creative, ctx: ctx({ duration_limit: 50, hour: 15 }), history: [] },
  { name: 'explorer, long weekend slot', profile: explorer, ctx: ctx({ duration_limit: 180, hour: 9, mood: 'high' }), history: [] },
  { name: 'homebody, 15 min, low energy', profile: homebody, ctx: ctx({ duration_limit: 15, mood: 'low' }), history: [] },
  { name: 'walker after three badminton-free skips', profile: walker, ctx: ctx({ duration_limit: 45 }), history: [ev('brisk_walk_loop', 'skipped', 1, { skip_reason: 'boring' }), ev('brisk_walk_loop', 'skipped', 2, { skip_reason: 'boring' }), ev('photo_walk_challenge', 'completed', 3, { enjoyment: 5 })] },
  { name: 'athlete who keeps completing badminton', profile: athlete, ctx: ctx({ duration_limit: 70, social_available: true }), history: [ev('badminton_game', 'completed', 1, { enjoyment: 5 }), ev('badminton_game', 'completed', 3, { enjoyment: 4 }), ev('badminton_game', 'completed', 5, { enjoyment: 5 }), ev('football_kickabout', 'skipped', 6, { skip_reason: 'no_friend' })] },
  { name: 'creative, rainy evening', profile: creative, ctx: ctx({ duration_limit: 40, weather: { category: 'rain', temp_c: 22 } }), history: [] },
  { name: 'explorer, night, clear sky', profile: explorer, ctx: ctx({ duration_limit: 40, hour: 20, is_daylight: false }), history: [] },
  { name: 'homebody, morning, friend free', profile: homebody, ctx: ctx({ duration_limit: 30, hour: 7, social_available: true }), history: [] },
  { name: 'walker, hot afternoon', profile: walker, ctx: ctx({ duration_limit: 30, hour: 14, weather: { category: 'clear', temp_c: 38 } }), history: [] },
  { name: 'athlete, 10 minutes only', profile: athlete, ctx: ctx({ duration_limit: 10 }), history: [] },
  { name: 'explorer, repeated cafe walks', profile: explorer, ctx: ctx({ duration_limit: 60 }), history: [ev('new_cafe_walk', 'completed', 1, { enjoyment: 4 }), ev('new_cafe_walk', 'completed', 2, { enjoyment: 4 }), ev('new_cafe_walk', 'completed', 4, { enjoyment: 3 })] },
  { name: 'walker, friend free, high energy', profile: walker, ctx: ctx({ duration_limit: 90, social_available: true, mood: 'high' }), history: [] },
  { name: 'creative, tired after too_tired skips', profile: creative, ctx: ctx({ duration_limit: 30, mood: 'low' }), history: [ev('bodyweight_park_circuit', 'skipped', 1, { skip_reason: 'too_tired' }), ev('easy_jog', 'skipped', 2, { skip_reason: 'too_tired' })] },
  { name: 'homebody, 45 min, mild day', profile: homebody, ctx: ctx({ duration_limit: 45 }), history: [ev('stretch_flow', 'completed', 1, { enjoyment: 5 }), ev('living_room_dance', 'completed', 2, { enjoyment: 4 })] },
  { name: 'athlete, late evening, friend free', profile: athlete, ctx: ctx({ duration_limit: 60, hour: 21, is_daylight: false, social_available: true }), history: [] },
  { name: 'walker, no weather data', profile: walker, ctx: ctx({ duration_limit: 50, weather: undefined }), history: [] },
  // Mirrors a real app request at 22:00 local time with no weather data (what the dev server sends at night).
  { name: 'walker, 22:00, no weather', profile: walker, ctx: { duration_limit: 60, social_available: false, mood: 'ok', hour: 22 }, history: [] },
]

/** Wraps a provider so the raw replies can be written to the report (synthetic data only). */
function recording(inner: AiProvider, log: { request: AiRequest; text?: string; error?: string }[]): AiProvider {
  return {
    name: inner.name,
    async complete(request, signal): Promise<AiCompletion> {
      const entry: { request: AiRequest; text?: string; error?: string } = { request }
      log.push(entry)
      try {
        const out = await inner.complete(request, signal)
        entry.text = out.text
        return out
      } catch (err) {
        entry.error = String((err as Error).message)
        throw err
      }
    },
  }
}

describe('LIVE: real Gemma 4 on Workers AI', () => {
  it(`runs ${N} controlled scenarios and reports validity, latency and quota use`, async () => {
    const proxy = await getPlatformProxy<{ AI: unknown }>({ configPath: 'wrangler.live.jsonc', persist: false })
    const base = new WorkersAiProvider(proxy.env.AI as AiBinding)

    const results: {
      scenario: string
      outcome: AiOutcome
      source: string
      chosen: string
      topCandidates: string[]
      reason?: string
      firstStep?: string
      calls: { text?: string; error?: string; verdict?: string }[]
    }[] = []

    const chosenScenarios = (ONLY ? SCENARIOS.filter((x) => x.name.includes(ONLY)) : SCENARIOS.slice(0, N)).flatMap((x) => Array.from({ length: REPEAT }, () => x))
    for (const s of chosenScenarios) {
      const planned = planDeterministic(s.profile, s.ctx, s.history)
      const ranking = rank(s.profile, s.ctx, s.history)
      const calls: { request: AiRequest; text?: string; error?: string }[] = []
      const { recommendation, outcome } = await refineWithAi({
        provider: recording(base, calls),
        profile: s.profile,
        ctx: s.ctx,
        ranking,
        deterministic: planned.recommendation,
        timeoutMs: 20_000, // generous for the first real measurements; production uses a tighter budget
      })
      results.push({
        scenario: s.name,
        outcome,
        source: recommendation.source,
        chosen: recommendation.activity_id,
        topCandidates: ranking.ranked.slice(0, 3).map((r) => r.activity.id),
        reason: recommendation.reason,
        firstStep: recommendation.first_step,
        calls: calls.map((c) => {
          // Re-run the validator on each raw reply so the report says WHY a reply was rejected.
          const pc = buildPrompt(s.profile, s.ctx, ranking.ranked.slice(0, 3)).context
          const v = c.text ? validateChoice(extractJsonObject(c.text), pc) : undefined
          return { text: c.text, error: c.error, verdict: v ? (v.ok ? 'accepted' : `rejected: ${v.reason}`) : undefined }
        }),
      })
    }
    await proxy.dispose()

    const ok = results.filter((r) => r.outcome.status === 'ok')
    const totalNeurons = results.reduce((a, r) => a + (r.outcome.neurons ?? 0), 0)
    const lat = results.map((r) => r.outcome.ms).sort((a, b) => a - b)
    const summary = {
      model: GEMMA_MODEL,
      scenarios: results.length,
      okFirstOrSecondTry: ok.length,
      okFirstTry: ok.filter((r) => r.outcome.attempts === 1).length,
      statuses: Object.fromEntries([...new Set(results.map((r) => r.outcome.status))].map((st) => [st, results.filter((r) => r.outcome.status === st).length])),
      avgNeuronsPerCall: results.length ? +(totalNeurons / results.length).toFixed(2) : 0,
      estimatedCallsPerDay: totalNeurons ? Math.floor(10_000 / (totalNeurons / results.length)) : null,
      latencyMs: { min: lat[0], median: lat[Math.floor(lat.length / 2)], max: lat[lat.length - 1] },
      aiChoseDifferentFromTop: ok.filter((r) => r.chosen !== r.topCandidates[0]).length,
    }
    writeFileSync(OUT, JSON.stringify({ summary, results }, null, 2))
    console.log(JSON.stringify(summary, null, 2))

    // The report's acceptance bar is "valid with no manual repair": allow the built-in single retry, then a safe fallback.
    expect(results.length).toBeGreaterThan(0)
    expect(ok.length / results.length).toBeGreaterThanOrEqual(0.9)
  }, 600_000)
})
