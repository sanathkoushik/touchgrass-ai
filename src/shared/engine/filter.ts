import type { Activity, Context, FilterResult, Rejection, UserProfile, Weather } from './types'
import { effectiveMood } from './modes'

/** Late-night window in which anything requiring travel is excluded, for safety. */
const LATE_NIGHT_START = 23
const LATE_NIGHT_END = 5

/** Comfortable outdoor range for `fair` activities (deg C). */
const FAIR_MIN_C = 8
const FAIR_MAX_C = 32

/** Lowercase + trim so "Running " matches "running". */
export function norm(s: string): string {
  return s.trim().toLowerCase()
}

/**
 * Loose term match: exact, or one starts with the other once both are at least 4 chars
 * ("walk" ~ "walking", "swim" ~ "swimming"). Deliberately simple and predictable.
 */
export function termsMatch(a: string, b: string): boolean {
  const x = norm(a)
  const y = norm(b)
  if (!x || !y) return false
  if (x === y) return true
  if (x.length >= 4 && y.length >= 4) return x.startsWith(y) || y.startsWith(x)
  return false
}

/** Returns the first term in `terms` that matches the activity (by id, tag or title word), if any. */
export function matchingTerm(activity: Activity, terms: string[]): string | null {
  const haystack = [activity.id, ...activity.tags]
  for (const term of terms) {
    if (haystack.some((h) => termsMatch(h, term))) return term
  }
  return null
}

function isDaylight(ctx: Context): boolean {
  if (typeof ctx.is_daylight === 'boolean') return ctx.is_daylight
  return ctx.hour >= 6 && ctx.hour < 18
}

function isLateNight(hour: number): boolean {
  return hour >= LATE_NIGHT_START || hour < LATE_NIGHT_END
}

function isDry(w: Weather): boolean {
  return w.category !== 'rain' && w.category !== 'storm' && w.category !== 'snow'
}

/** Why `activity` cannot be done right now. Empty array means it is allowed. */
export function rejectionReasons(activity: Activity, profile: UserProfile, ctx: Context): string[] {
  const reasons: string[] = []

  // Explicit dislikes always win over everything else.
  const disliked = matchingTerm(activity, profile.preferences.dislikes)
  if (disliked) reasons.push(`user dislikes "${disliked}"`)

  // Time available.
  if (activity.duration.min > ctx.duration_limit) {
    reasons.push(`needs at least ${activity.duration.min} min, only ${ctx.duration_limit} available`)
  }

  // People.
  if (!ctx.social_available && (activity.needsOthers || !activity.social.includes('solo'))) {
    reasons.push('needs other people and nobody is free')
  }

  // Gear.
  const missing = activity.equipment.filter((e) => !profile.equipment.includes(e))
  if (missing.length > 0) reasons.push(`missing equipment: ${missing.join(', ')}`)

  // Known avoidances.
  if (profile.avoidances.includes('too_far') && activity.travel === 'far') {
    reasons.push('involves long travel (user avoids)')
  }
  if (profile.avoidances.includes('high_cost') && activity.cost === 'medium') {
    reasons.push('costs too much (user avoids)')
  }

  // Things the person explicitly asked never to see again.
  if (profile.avoid_activities?.includes(activity.id)) reasons.push('asked not to see this again')

  // Energy.
  if (effectiveMood(ctx) === 'low' && activity.intensity === 3) {
    reasons.push('too intense for a low-energy moment')
  }
  // A "minimum" day is about making starting easy, so nothing that needs a long trip.
  if (ctx.mode === 'minimum' && activity.travel === 'far') {
    reasons.push('too much effort for a small start')
  }

  // Light.
  const day = isDaylight(ctx)
  if (activity.daylight === 'day' && !day) reasons.push('needs daylight')
  if (activity.daylight === 'night' && day) reasons.push('needs darkness')
  if (isLateNight(ctx.hour) && activity.travel !== 'none') {
    reasons.push('involves going out late at night')
  }

  // Weather. Unknown weather never filters anything: the engine degrades gracefully.
  const w = ctx.weather
  if (w) {
    switch (activity.weather) {
      case 'any':
        break
      case 'dry':
        if (!isDry(w)) reasons.push(`weather is ${w.category}`)
        break
      case 'fair':
        if (!isDry(w)) reasons.push(`weather is ${w.category}`)
        else if (w.temp_c < FAIR_MIN_C || w.temp_c > FAIR_MAX_C) {
          reasons.push(`${Math.round(w.temp_c)} C is outside the comfortable range`)
        }
        break
      case 'clear_sky':
        if (w.category !== 'clear') reasons.push(`sky is not clear (${w.category})`)
        break
    }
  }

  return reasons
}

/** Splits the catalog into allowed candidates and rejected activities (with reasons). */
export function filterActivities(
  activities: Activity[],
  profile: UserProfile,
  ctx: Context,
): FilterResult {
  const candidates: Activity[] = []
  const rejected: Rejection[] = []
  for (const activity of activities) {
    const reasons = rejectionReasons(activity, profile, ctx)
    if (reasons.length === 0) candidates.push(activity)
    else rejected.push({ activity_id: activity.id, reasons })
  }
  return { candidates, rejected }
}
