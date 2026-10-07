import { getActivity } from './activities'
import { matchingTerm, termsMatch } from './filter'
import type {
  Activity,
  Context,
  HistoryEvent,
  ScoreComponent,
  ScoredActivity,
  UserProfile,
} from './types'

/** Relative importance of each component in the final score. */
export const WEIGHTS: Record<ScoreComponent, number> = {
  preference: 3.0,
  enjoyment: 1.0,
  novelty: 1.0,
  social_fit: 1.0,
  time_fit: 0.8,
  duration_fit: 0.8,
  friction: 1.5,
  mood_fit: 0.8,
}

/** Neutral completion rate used when there is no stated preference and no data. */
const PRIOR_RATE = 0.5
/** How much a stated like raises the prior completion rate (declared 1.0 -> 0.9). */
const DECLARED_LIFT = 0.4
/** The stated preference counts as this many pseudo-observations; real events then override it. */
const DECLARED_STRENGTH = 3
/** Smoothing for time-of-day stats, which have no stated preference behind them. */
const TIME_PRIOR_STRENGTH = 2
/** Tag-peers (other activities sharing a tag) count for half as much as the activity itself. */
const PEER_WEIGHT = 0.5
/** Only the newest events matter for repetition and friction. */
const RECENT_WINDOW = 8

interface Stats {
  /** Weighted number of events. */
  n: number
  /** Weighted completion credit: completed 1, partial 0.5, otherwise 0. */
  done: number
}

function outcomeCredit(e: HistoryEvent): number {
  if (e.outcome === 'completed') return 1
  if (e.outcome === 'partial') return 0.5
  return 0
}

/** `changed` means the user swapped it for something else: a weak negative, so it counts for less. */
function outcomeWeight(e: HistoryEvent): number {
  return e.outcome === 'changed' ? 0.5 : 1
}

/**
 * Wall-clock hour as stored in the timestamp string, NOT converted to the runtime timezone.
 * (The Worker runs in UTC; the user's own local time is what we want, e.g. "...T17:42:00+05:30" -> 17.)
 */
export function hourOf(timestamp: string): number {
  const h = Number.parseInt(timestamp.slice(11, 13), 10)
  return Number.isFinite(h) ? h : 12
}

function circularHourDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 24
  return Math.min(d, 24 - d)
}

function sharesTag(a: Activity, b: Activity): boolean {
  return a.tags.some((t) => b.tags.some((u) => termsMatch(t, u)))
}

/** Newest first. Does not mutate the input. */
function newestFirst(history: HistoryEvent[]): HistoryEvent[] {
  return [...history].sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0))
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x))
}

/** Events about this exact activity, and events about other activities that share a tag with it. */
function relatedEvents(activity: Activity, history: HistoryEvent[]) {
  const own: HistoryEvent[] = []
  const peers: HistoryEvent[] = []
  for (const e of history) {
    if (e.activity_id === activity.id) {
      own.push(e)
      continue
    }
    const other = getActivity(e.activity_id)
    if (other && sharesTag(activity, other)) peers.push(e)
  }
  return { own, peers }
}

function statsOf(events: HistoryEvent[]): Stats {
  let n = 0
  let done = 0
  for (const e of events) {
    const w = outcomeWeight(e)
    n += w
    done += outcomeCredit(e) * w
  }
  return { n, done }
}

/**
 * Preference = expected completion rate, as a number from -1 (never) to +1 (always).
 * What the user SAYS (likes, motivators) is only the starting belief, worth a few pseudo-observations.
 * What the user DOES then overrides it: a liked activity that keeps getting skipped sinks below one that
 * keeps getting done, while each success can only raise (never lower) an activity's score.
 */
function preferenceComponent(
  activity: Activity,
  profile: UserProfile,
  own: Stats,
  peers: Stats,
): { value: number; like: string | null } {
  const like = matchingTerm(activity, profile.preferences.likes)
  const motivatorOverlap = activity.motivators.filter((m) => profile.motivators.includes(m)).length
  const declared = clamp((like ? 0.7 : 0) + 0.15 * motivatorOverlap, 0, 1)

  const nEff = own.n + PEER_WEIGHT * peers.n
  const doneEff = own.done + PEER_WEIGHT * peers.done
  const priorRate = PRIOR_RATE + DECLARED_LIFT * declared
  const rate = (doneEff + priorRate * DECLARED_STRENGTH) / (nEff + DECLARED_STRENGTH)

  return { value: rate * 2 - 1, like }
}

function enjoymentComponent(own: HistoryEvent[], peers: HistoryEvent[]): number {
  let sum = 0
  let n = 0
  for (const [events, w] of [
    [own, 1],
    [peers, PEER_WEIGHT],
  ] as const) {
    for (const e of events) {
      if ((e.outcome === 'completed' || e.outcome === 'partial') && typeof e.enjoyment === 'number') {
        sum += clamp(e.enjoyment, 1, 5) * w
        n += w
      }
    }
  }
  if (n === 0) return 0
  const avg = sum / n // 1..5
  const confidence = n / (n + 2)
  return ((avg - 3) / 2) * confidence
}

function noveltyComponent(
  activity: Activity,
  profile: UserProfile,
  recent: HistoryEvent[],
): { value: number; recentlySuggested: boolean } {
  const wantsNovelty = profile.motivators.includes('novelty') ? 1 : 0.4
  const fresh = ((activity.novelty - 1) / 2) * wantsNovelty // 0..1

  const idx = recent.findIndex((e) => e.activity_id === activity.id)
  const repeatPenalty = idx === -1 ? 0 : -0.8 * (1 - idx / RECENT_WINDOW)

  return { value: 0.5 * fresh + repeatPenalty, recentlySuggested: idx !== -1 && idx < 3 }
}

function socialComponent(activity: Activity, profile: UserProfile, ctx: Context): number {
  const pref = profile.preferences.social_preference
  let v = 0
  if (ctx.social_available) {
    if (pref === 'with_friend' || pref === 'small_group') {
      if (activity.social.includes(pref)) v += 0.6
    } else if (pref === 'solo') {
      if (activity.needsOthers) v -= 0.5
    } else if (activity.needsOthers) {
      v += 0.2 // "any": someone is free, so using them is a small plus
    }
    if (profile.motivators.includes('social') && activity.motivators.includes('social')) v += 0.3
  } else if (pref === 'solo' && activity.social.includes('solo')) {
    v += 0.2
  }
  return clamp(v, -1, 1)
}

/** Does this family tend to get done around this time of day? */
function timeComponent(activity: Activity, history: HistoryEvent[], ctx: Context): number {
  let n = 0
  let done = 0
  for (const e of history) {
    const other = getActivity(e.activity_id)
    if (!other || other.family !== activity.family) continue
    if (circularHourDistance(hourOf(e.timestamp), ctx.hour) > 2) continue
    n += 1
    done += outcomeCredit(e)
  }
  if (n === 0) return 0
  const rate = (done + PRIOR_RATE * TIME_PRIOR_STRENGTH) / (n + TIME_PRIOR_STRENGTH)
  return (rate * 2 - 1) * (n / (n + 2))
}

function durationComponent(activity: Activity, profile: UserProfile, ctx: Context): number {
  const planned = Math.min(activity.duration.default, activity.duration.max, ctx.duration_limit)
  const preferred = profile.preferences.preferred_duration_min
  const closeness = 1 - Math.abs(planned - preferred) / Math.max(planned, preferred)
  return clamp(closeness, 0, 1) - 0.5
}

/**
 * Why things failed before. Skip reasons only count against activities they actually relate to
 * (the same activity or one sharing a tag), and fade with age.
 */
function frictionComponent(activity: Activity, recent: HistoryEvent[]): number {
  let penalty = 0
  recent.forEach((e, idx) => {
    if (e.outcome !== 'skipped' || !e.skip_reason) return
    const sameActivity = e.activity_id === activity.id
    const other = getActivity(e.activity_id)
    const related = sameActivity || (other !== undefined && sharesTag(activity, other))
    if (!related) return

    const decay = 1 / (1 + idx * 0.15)
    let p = 0
    switch (e.skip_reason) {
      case 'too_far':
        p = activity.travel === 'far' ? 0.4 : activity.travel === 'short' ? 0.15 : 0
        break
      case 'too_tired':
        p = (activity.intensity - 1) * 0.2
        break
      case 'no_time':
        p = activity.duration.default > 30 ? 0.2 : 0
        break
      case 'bad_weather':
        p = activity.weather === 'any' ? 0 : 0.3
        break
      case 'too_costly':
        p = activity.cost === 'medium' ? 0.4 : activity.cost === 'low' ? 0.2 : 0
        break
      case 'no_friend':
        p = activity.needsOthers ? 0.4 : 0
        break
      case 'boring':
        p = sameActivity ? 0.5 : 0
        break
      case 'other':
        p = sameActivity ? 0.1 : 0
        break
    }
    penalty += p * decay
  })
  return penalty === 0 ? 0 : -clamp(penalty, 0, 1)
}

function moodComponent(activity: Activity, ctx: Context): number {
  if (ctx.mood === 'low') return activity.intensity === 1 ? 0.4 : 0
  if (ctx.mood === 'high') return activity.intensity === 1 ? -0.1 : activity.intensity === 2 ? 0.2 : 0.3
  return 0
}

/** Scores every candidate. Pure and deterministic: ties are broken by activity id. */
export function scoreActivities(
  candidates: Activity[],
  profile: UserProfile,
  ctx: Context,
  history: HistoryEvent[] = [],
): ScoredActivity[] {
  const ordered = newestFirst(history)
  const recent = ordered.slice(0, RECENT_WINDOW)

  const scored = candidates.map((activity): ScoredActivity => {
    const { own, peers } = relatedEvents(activity, ordered)
    const ownStats = statsOf(own)
    const peerStats = statsOf(peers)

    const pref = preferenceComponent(activity, profile, ownStats, peerStats)
    const nov = noveltyComponent(activity, profile, recent)

    const components: Record<ScoreComponent, number> = {
      preference: pref.value,
      enjoyment: enjoymentComponent(own, peers),
      novelty: nov.value,
      social_fit: socialComponent(activity, profile, ctx),
      time_fit: timeComponent(activity, ordered, ctx),
      duration_fit: durationComponent(activity, profile, ctx),
      friction: frictionComponent(activity, recent),
      mood_fit: moodComponent(activity, ctx),
    }

    let score = 0
    for (const key of Object.keys(WEIGHTS) as ScoreComponent[]) score += WEIGHTS[key] * components[key]

    return {
      activity,
      score,
      components,
      evidence: {
        observed_n: own.length,
        observed_done: own.filter((e) => e.outcome === 'completed').length,
        declared_like: pref.like,
        recently_suggested: nov.recentlySuggested,
        history_size: ordered.length,
      },
    }
  })

  return scored.sort((a, b) => b.score - a.score || (a.activity.id < b.activity.id ? -1 : 1))
}
