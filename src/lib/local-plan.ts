import type { ProfileInput, RecommendInput, RecommendResponse } from '@/shared/api'

/**
 * The last line of defence: when the server cannot be reached at all, plan on the device itself.
 *
 * The recommendation engine is plain TypeScript with no network, so the same code that runs on the server runs here,
 * from the profile copy kept in this browser. What it cannot know offline is honest and visible: no history (so no
 * learning from past answers), no live weather, and the pick is marked as not saved.
 *
 * Loaded on demand (dynamic import) so the engine is not part of the first-visit download.
 */
export async function planOnDevice(input: RecommendInput, profile: ProfileInput, now: Date = new Date()): Promise<RecommendResponse> {
  const { chooseMode, planDeterministic } = await import('@/shared/engine')

  const mood = input.mood ?? 'ok'
  const requested = input.mode ?? 'auto'
  const sizing = requested === 'auto' ? chooseMode([], mood) : { mode: requested, cause: 'chosen' as const }

  const { recommendation } = planDeterministic(
    {
      user_id: 'on_device',
      preferences: profile.preferences,
      motivators: profile.motivators,
      avoidances: profile.avoidances,
      equipment: profile.equipment,
      goals: profile.goals ?? [],
    },
    {
      duration_limit: input.duration_limit,
      social_available: input.social_available ?? false,
      mood,
      mode: sizing.mode,
      ...(sizing.cause ? { mode_cause: sizing.cause } : {}),
      hour: now.getHours(),
    },
    [],
  )

  return {
    ...recommendation,
    recommendation_id: `r_${crypto.randomUUID()}`,
    persisted: false,
  }
}
