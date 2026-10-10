import { ACTIVITIES, GUARANTEED_FALLBACK_ID, getActivity } from './activities'
import { buildCompanion } from './companion'
import { filterActivities } from './filter'
import { scoreActivities } from './score'
import type {
  DesiredOutcome,
  ActivityMode,
  Bundle,
  Equipment,
  Goal,
  WeatherCategory,
  Activity,
  Context,
  HistoryEvent,
  Recommendation,
  Rejection,
  ScoredActivity,
  SkipReason,
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
  // minimum = the smallest real version; excellent = as long as the time allows (up to the activity's max).
  if (ctx.mode === 'minimum') return activity.duration.min
  if (ctx.mode === 'excellent') return Math.max(activity.duration.min, upper)
  return Math.max(activity.duration.min, Math.min(activity.duration.default, upper))
}

const EQUIPMENT_PREP: Record<Equipment, string> = {
  bicycle: 'Your bicycle',
  racket: 'Your racket',
  ball: 'A ball',
  swimwear: 'Swimwear',
  yoga_mat: 'Your yoga mat',
  sketchbook: 'Your sketchbook',
  cards: 'Cards or a board game',
  trash_bag: 'A bag for litter',
}

const BUNDLE_PREP: Record<Bundle, string> = {
  music: 'Optional: a playlist you like',
  podcast: 'Optional: a podcast episode',
  audiobook: 'Optional: an audiobook',
  call: 'Optional: a friend to call',
  photo: 'Optional: your phone camera',
}

/** What to have ready. Comes only from the activity's own equipment and bundle data. */
export function preparationFor(activity: Activity): string[] {
  return [...activity.equipment.map((e) => EQUIPMENT_PREP[e]), ...activity.bundles.map((b) => BUNDLE_PREP[b])]
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
export function evidenceFacts(scored: ScoredActivity, ctx: Context): string[] {
  const { activity, components, evidence } = scored
  const parts: string[] = []

  // 1. The adaptation itself: why THIS size, and what it fixes from last time. These are the learning the person can see.
  const modeFact = modeSentence(ctx)
  if (modeFact) parts.push(modeFact)
  if (evidence.addresses_skip && SKIP_FIX[evidence.addresses_skip]) {
    // "Too tired" is answered by something that can be done sitting down, when it can.
    parts.push(evidence.addresses_skip === 'too_tired' && activity.tags.includes('seated') ? 'You said the last one wore you out; this one can be done sitting down.' : SKIP_FIX[evidence.addresses_skip])
  }
  if (evidence.outcome_fit && ctx.desired_outcome) parts.push(OUTCOME_FACT[ctx.desired_outcome])
  if (evidence.learned_text) parts.push(evidence.learned_text)
  if (evidence.observed_enjoyment_avg !== null && evidence.observed_enjoyment_avg >= 4) {
    parts.push(`You rated this ${evidence.observed_enjoyment_avg} out of 5 before.`)
  }

  if (evidence.observed_n >= 2 && evidence.observed_done / evidence.observed_n >= 0.5) {
    parts.push(`You have finished this ${evidence.observed_done} of ${evidence.observed_n} times.`)
  }
  if (evidence.declared_like) parts.push(`You said you like ${evidence.declared_like}.`)
  else if (evidence.declared_goal) parts.push(`It fits your goal to ${GOAL_PHRASE[evidence.declared_goal]}.`)
  if (ctx.social_available && components.social_fit >= 0.5) parts.push('Someone is free to join you.')
  // "Fresh compared to your recent picks" is only true if there ARE recent picks.
  if (evidence.history_size > 0 && !evidence.recently_suggested && activity.novelty >= 2 && components.novelty > 0.2) {
    parts.push('It is a fresh change from your recent picks.')
  }
  if (ctx.mood === 'low' && activity.intensity === 1 && ctx.mode !== 'minimum') parts.push('It is gentle, which suits a low-energy moment.')
  if (components.time_fit >= 0.3) parts.push('Activities like this have worked for you around this time of day.')
  // Live conditions are only mentioned when we really have them AND they matter for this activity (it is outdoors).
  // The filter has already confirmed the conditions suit it, so the statement is both true and relevant.
  if (ctx.weather && activity.weather === 'clear_sky') {
    parts.push('The sky is clear right now.')
  } else if (ctx.weather && activity.weather !== 'any') {
    parts.push(`It is ${SKY_WORD[ctx.weather.category]} and ${Math.round(ctx.weather.temp_c)} degrees outside.`)
  }
  return parts
}

const OUTCOME_FACT: Record<DesiredOutcome, string> = {
  clear_head: 'You wanted to clear your head; this one is calm and quiet.',
  energise: 'You wanted to feel more energetic; this one gets you moving.',
  break_routine: 'You wanted to break the routine; this one is a change from the usual.',
  connect: 'You wanted to feel connected; this one is better with other people.',
}

const SKIP_FIX: Record<SkipReason, string> = {
  too_far: 'You said the last one was too far; this needs no travel.',
  too_tired: 'You said the last one wore you out; this one is gentle.',
  no_time: 'You said the last one took too long; this one is quick.',
  bad_weather: 'The last one was spoiled by weather; this works in any weather.',
  too_costly: 'You said the last one cost too much; this one is free.',
  no_friend: 'You had no one to join the last one; this works on your own.',
  boring: '',
  couldnt_start: 'You found the last one hard to start; this one is small and easy to begin.',
  other: '',
}

const GOAL_PHRASE: Record<Goal, string> = {
  move_more: 'move more',
  be_outdoors: 'spend time outdoors',
  feel_calmer: 'feel calmer',
  meet_people: 'meet people',
  try_new_things: 'try new things',
  be_creative: 'be creative',
}

/** Why this size, only when the size is not simply "normal". */
function modeSentence(ctx: Context): string | null {
  switch (ctx.mode_cause) {
    case 'recovery':
      return 'Your last two did not happen, so this one is small on purpose.'
    case 'low_energy':
      return 'Kept short and easy for a low-energy moment.'
    case 'momentum':
      return 'Your last two went well, so this one stretches a little.'
    case 'hard_start':
      return 'Last time, starting was the hard part, so this one begins with just two minutes.'
    case 'chosen':
      return ctx.mode === 'minimum' ? 'You asked for a small start.' : ctx.mode === 'excellent' ? 'You asked for a bigger one.' : null
    default:
      return null
  }
}

const SKY_WORD: Record<WeatherCategory, string> = {
  clear: 'clear',
  cloudy: 'cloudy',
  fog: 'foggy',
  rain: 'rainy',
  storm: 'stormy',
  snow: 'snowy',
}

/** The explanation shown with a deterministic recommendation: at most two of the true statements. */
export function explain(scored: ScoredActivity, ctx: Context): string {
  const { activity } = scored
  const parts = evidenceFacts(scored, ctx)

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
  const recommendation = buildRecommendation(ranking, profile, ctx)
  return { recommendation, ranking }
}

export interface RecommendationOverrides {
  /** Choose this activity from the ranking instead of the top one. Must be present in `ranking.ranked`. */
  activityId?: string
  /** Replace the wording (used when an AI writes it). The activity facts (title, duration, mode) always stay ours. */
  reason?: string
  firstStep?: string
  source?: Recommendation['source']
  model?: string
}

/** Turns a ranking into the response shape. Title, duration and social mode always come from the catalog and engine. */
export function buildRecommendation(
  ranking: Ranking,
  profile: UserProfile,
  ctx: Context,
  overrides: RecommendationOverrides = {},
): Recommendation {
  const primary =
    (overrides.activityId ? ranking.ranked.find((s) => s.activity.id === overrides.activityId) : undefined) ?? ranking.ranked[0]
  if (!primary) throw new Error('rank() returned no activities') // unreachable by construction
  const rest = ranking.ranked.filter((s) => s !== primary)

  return {
    activity_id: primary.activity.id,
    title: primary.activity.title,
    duration_min: planDuration(primary.activity, ctx),
    mode: (ctx.mode ?? 'normal') satisfies ActivityMode,
    companion: buildCompanion(primary.activity, ctx, planDuration(primary.activity, ctx)),
    preparation: preparationFor(primary.activity),
    reason: overrides.reason ?? explain(primary, ctx),
    first_step: overrides.firstStep ?? primary.activity.firstStep,
    social_mode: planSocialMode(primary.activity, profile, ctx),
    fallback: pickFallback(primary, rest),
    source: overrides.source ?? 'deterministic',
    ...(overrides.model ? { model: overrides.model } : {}),
  }
}
