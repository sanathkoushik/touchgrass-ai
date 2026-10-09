import { buildRecommendation, type Ranking } from '@/shared/engine'
import type { Context, Recommendation, UserProfile } from '@/shared/engine/types'
import { AiUnavailableError, type AiProvider } from './provider'
import { buildPrompt, extractJsonObject, validateChoice } from './prompt'

/** Gemma 4 26B A4B price in Neurons per million tokens (Cloudflare pricing page, checked 2026-10-09). */
const NEURONS_PER_M_INPUT = 9091
const NEURONS_PER_M_OUTPUT = 27273

export type AiOutcomeStatus = 'ok' | 'skipped' | 'invalid' | 'busy' | 'quota' | 'timeout' | 'error'

export interface AiOutcome {
  status: AiOutcomeStatus
  /** How many times the model was asked (0 when skipped). */
  attempts: number
  ms: number
  inputTokens?: number
  outputTokens?: number
  /** Approximate free-tier neurons spent, for budget tracking. */
  neuronsEstimate?: number
  model?: string
}

export interface RefineArgs {
  provider: AiProvider
  profile: UserProfile
  ctx: Context
  ranking: Ranking
  /** The answer to return if the AI cannot help. Always valid on its own. */
  deterministic: Recommendation
  /** Total time budget across both attempts. */
  timeoutMs?: number
  /** How many top candidates the model may choose from. */
  topN?: number
  now?: () => number
}

/**
 * Lets the AI choose among the top candidates and word the result. Never throws and never blocks past
 * `timeoutMs`: any failure returns the deterministic recommendation unchanged.
 */
export async function refineWithAi(args: RefineArgs): Promise<{ recommendation: Recommendation; outcome: AiOutcome }> {
  const { provider, profile, ctx, ranking, deterministic, timeoutMs = 6000, topN = 3, now = Date.now } = args
  const started = now()
  const outcome: AiOutcome = { status: 'skipped', attempts: 0, ms: 0 }
  const done = (recommendation: Recommendation) => {
    outcome.ms = now() - started
    return { recommendation, outcome }
  }

  const candidates = ranking.ranked.slice(0, topN)
  // Nothing to choose between (or the safety net was used): do not spend quota on it.
  if (ranking.usedGuaranteedFallback || candidates.length < 2) return done(deterministic)

  let hint: string | undefined
  for (let attempt = 1; attempt <= 2; attempt++) {
    const remaining = timeoutMs - (now() - started)
    if (remaining <= 0) {
      outcome.status = 'timeout'
      return done(deterministic)
    }

    const { request, context } = buildPrompt(profile, ctx, candidates, hint)
    outcome.attempts = attempt
    try {
      const completion = await provider.complete(request, AbortSignal.timeout(remaining))
      outcome.model = completion.model
      if (completion.usage) {
        outcome.inputTokens = (outcome.inputTokens ?? 0) + completion.usage.inputTokens
        outcome.outputTokens = (outcome.outputTokens ?? 0) + completion.usage.outputTokens
        outcome.neuronsEstimate =
          (outcome.inputTokens * NEURONS_PER_M_INPUT + (outcome.outputTokens ?? 0) * NEURONS_PER_M_OUTPUT) / 1_000_000
      }

      const verdict = validateChoice(extractJsonObject(completion.text), context)
      if (verdict.ok) {
        outcome.status = 'ok'
        return done(
          buildRecommendation(ranking, profile, ctx, {
            activityId: verdict.choice.activityId,
            reason: verdict.choice.reason,
            firstStep: verdict.choice.firstStep,
            source: 'ai',
            model: completion.model,
          }),
        )
      }
      outcome.status = 'invalid'
      hint = verdict.reason
    } catch (err) {
      // Availability problems are not worth retrying: answer from the engine right away.
      outcome.status = err instanceof AiUnavailableError ? err.kind : 'error'
      return done(deterministic)
    }
  }
  return done(deterministic)
}
