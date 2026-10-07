import { ACTIVITIES, GUARANTEED_FALLBACK_ID, getActivity } from './activities'
import { filterActivities } from './filter'
import { scoreActivities } from './score'
import type {
  Activity,
  Context,
  HistoryEvent,
  Recommendation,
  Rejection,
  ScoredActivity,
  SocialMode,
  UserProfile,
} from './types'

export interface Ranking {
  /** Allowed activities, best first. Never empty (see `doorstep_reset`). */
  ranked: ScoredActivity[]
  rejected: Rejection[]
  /** True when the filter left nothing and the guaranteed fallback was used. */
  usedGuaranteedFallback: boolean
}

/** Filter, then score. This is the exact shortlist that will later be handed to Gemma. */
export function rank(
  profile: UserProfile,
  ctx: Context,
  history: HistoryEvent[] = [],
  activities: Activity[] = ACTIVITIES,
): Ranking {
  const { candidates, rejected } = filterActivities(activities, profile, ctx)
  if (candidates.length > 0) {
    return { ranked: scoreActivities(candidates, profile, ctx, history), rejected, usedGuaranteedFallback: false }
  }
  // Nothing passed the hard filter. The guaranteed activity ignores dislikes on purpose:
  // an answer that is tiny and safe beats an empty screen.
  const safe = getActivity(GUARANTEED_FALLBACK_ID)
  if (!safe) throw new Error(`Guaranteed fallback activity "${GUARANTEED_FALLBACK_ID}" is missing from the catalog`)
  return { ranked: scoreActivities([safe], profile, ctx, history), rejected, usedGuaranteedFallback: true }
}

/** Minutes to suggest: the activity's default, never above what the user has or the activity's max. */
export function planDuration(activity: Activity, ctx: Context): number {
  const upper = Math.min(activity.duration.max, ctx.duration_limit)
  return Math.max(activity.duration.min, Math.min(activity.duration.default, upper))
}

/** Picks how to do it, preferring what the user prefers when it is possible right now. */
export function planSocialMode(activity: Activity, profile: UserProfile, ctx: Context): SocialMode {
  const pref = profile.preferences.social_preference
  const options = ctx.social_available ? activity.social : activity.social.filter((m) => m === 'solo')
  const usable: SocialMode[] = options.length > 0 ? options : ['solo']
  if (pref !== 'any' && usable.includes(pref)) return pref
  if (ctx.social_available && activity.needsOthers) return usable[0] ?? 'with_friend'
  return usable.includes('solo') ? 'solo' : (usable[0] ?? 'solo')
}

/**
 * Builds the explanation from evidence we really have. Nothing here is guessed:
 * each sentence is only emitted when the data behind it exists.
 */
export function explain(scored: ScoredActivity, ctx: Context): string {
  const { activity, components, evidence } = scored
  const parts: string[] = []

  if (evidence.observed_n >= 2 && evidence.observed_done / evidence.observed_n >= 0.5) {
    parts.push(`You have finished this ${evidence.observed_done} of ${evidence.observed_n} times.`)
  }
  if (evidence.declared_like) parts.push(`You said you like ${evidence.declared_like}.`)
  if (ctx.social_available && components.social_fit >= 0.5) parts.push('Someone is free to join you.')
  // "Fresh compared to your recent picks" is only true if there ARE recent picks.
  if (evidence.history_size > 0 && !evidence.recently_suggested && activity.novelty >= 2 && components.novelty > 0.2) {
    parts.push('It is a fresh change from your recent picks.')
  }
  if (ctx.mood === 'low' && activity.intensity === 1) parts.push('It is gentle, which suits a low-energy moment.')
  if (components.time_fit >= 0.3) parts.push('Activities like this have worked for you around this time of day.')

  const planned = planDuration(activity, ctx)
  if (parts.length === 0) parts.push(`It fits the ${ctx.duration_limit} minutes you have.`)
  else if (planned < ctx.duration_limit && parts.length < 2) parts.push(`It fits the ${ctx.duration_limit} minutes you have.`)

  return parts.slice(0, 2).join(' ')
}

/** A second option that asks less of the user than the main one, so a failed first pick is easy to swap. */
function pickFallback(primary: ScoredActivity, rest: ScoredActivity[]): Recommendation['fallback'] {
  const easier = rest.find(
    (s) =>
      s.activity.id !== primary.activity.id &&
      s.activity.intensity <= primary.activity.intensity &&
      s.activity.duration.default <= primary.activity.duration.default,
  )
  const chosen = easier?.activity ?? (primary.activity.id === GUARANTEED_FALLBACK_ID ? undefined : getActivity(GUARANTEED_FALLBACK_ID))
  if (!chosen) return null
  return { activity_id: chosen.id, title: chosen.title, first_step: chosen.firstStep }
}

/**
 * The deterministic planner: always returns a valid recommendation with no AI and no network.
 * This is a product feature, not just a safety net: Gemma later improves the *ranking and wording*.
 */
export function planDeterministic(
  profile: UserProfile,
  ctx: Context,
  history: HistoryEvent[] = [],
  activities: Activity[] = ACTIVITIES,
): { recommendation: Recommendation; ranking: Ranking } {
  const ranking = rank(profile, ctx, history, activities)
  const [primary, ...rest] = ranking.ranked
  if (!primary) throw new Error('rank() returned no activities') // unreachable by construction

  const recommendation: Recommendation = {
    activity_id: primary.activity.id,
    title: primary.activity.title,
    duration_min: planDuration(primary.activity, ctx),
    reason: explain(primary, ctx),
    first_step: primary.activity.firstStep,
    social_mode: planSocialMode(primary.activity, profile, ctx),
    fallback: pickFallback(primary, rest),
    source: 'deterministic',
  }
  return { recommendation, ranking }
}
