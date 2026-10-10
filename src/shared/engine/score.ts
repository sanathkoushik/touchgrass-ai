import { getActivity } from './activities'
import { matchingTerm, termsMatch } from './filter'
import { effectiveMood } from './modes'
import type {
  DesiredOutcome,
  Activity,
  Goal,
  SkipReason,
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
  outcome_fit: 1.2,
  learned: 1.0,
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
/** Each stated goal an activity supports nudges its starting belief. Real behaviour still overrides it. */
const GOAL_LIFT = 0.15
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

/** Which stated goals an activity genuinely supports (from its own catalog data, nothing guessed). */
const GOAL_MATCH: Record<Goal, (a: Activity) => boolean> = {
  move_more: (a) => a.family === 'movement',
  be_outdoors: (a) => a.weather !== 'any' || a.motivators.includes('nature'),
  feel_calmer: (a) => a.motivators.includes('calm'),
  meet_people: (a) => a.social.includes('with_friend') || a.social.includes('small_group'),
  try_new_things: (a) => a.novelty >= 2,
  be_creative: (a) => a.motivators.includes('creativity'),
}

function matchingGoals(activity: Activity, profile: UserProfile): Goal[] {
  return (profile.goals ?? []).filter((g) => GOAL_MATCH[g](activity))
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
): { value: number; like: string | null; goal: Goal | null } {
  const like = matchingTerm(activity, profile.preferences.likes)
  const motivatorOverlap = activity.motivators.filter((m) => profile.motivators.includes(m)).length
  const goals = matchingGoals(activity, profile)
  const declared = clamp((like ? 0.7 : 0) + 0.15 * motivatorOverlap + GOAL_LIFT * goals.length, 0, 1)

  const nEff = own.n + PEER_WEIGHT * peers.n
  const doneEff = own.done + PEER_WEIGHT * peers.done
  const priorRate = PRIOR_RATE + DECLARED_LIFT * declared
  const rate = (doneEff + priorRate * DECLARED_STRENGTH) / (nEff + DECLARED_STRENGTH)

  return { value: rate * 2 - 1, like, goal: goals[0] ?? null }
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

function enjoymentEvidence(own: HistoryEvent[]): { observed_enjoyment_avg: number | null; observed_enjoyment_n: number } {
  const rated = own.filter((e) => (e.outcome === 'completed' || e.outcome === 'partial') && typeof e.enjoyment === 'number')
  if (rated.length === 0) return { observed_enjoyment_avg: null, observed_enjoyment_n: 0 }
  const avg = rated.reduce((s, e) => s + clamp(e.enjoyment as number, 1, 5), 0) / rated.length
  return { observed_enjoyment_avg: Math.round(avg * 10) / 10, observed_enjoyment_n: rated.length }
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
      case 'couldnt_start':
        // Hard to begin: long, intense or far things are the ones that stay hard to begin.
        p = (activity.duration.default > 30 ? 0.25 : 0) + (activity.intensity - 1) * 0.1 + (activity.travel === 'far' ? 0.15 : 0)
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
  const mood = effectiveMood(ctx)
  // A small start is easiest when it is also short.
  const shortBonus = ctx.mode === 'minimum' && activity.duration.min <= 15 ? 0.2 : 0
  if (mood === 'low') return (activity.intensity === 1 ? 0.4 : 0) + shortBonus
  if (mood === 'high') return activity.intensity === 1 ? -0.1 : activity.intensity === 2 ? 0.2 : 0.3
  return 0
}

/**
 * If one of the last few skips had a reason THIS activity specifically avoids (too far -> needs no travel),
 * returns that reason, so the explanation can say so truthfully.
 */
function addressedSkip(activity: Activity, recent: HistoryEvent[]): SkipReason | null {
  for (const e of recent.slice(0, 3)) {
    if (e.outcome !== 'skipped' || !e.skip_reason) continue
    const fixes: Partial<Record<SkipReason, boolean>> = {
      too_far: activity.travel === 'none',
      too_tired: activity.intensity === 1,
      no_time: activity.duration.default <= 30,
      bad_weather: activity.weather === 'any',
      too_costly: activity.cost === 'free',
      no_friend: !activity.needsOthers,
      couldnt_start: activity.duration.default <= 15,
    }
    return fixes[e.skip_reason] ? e.skip_reason : null // only the MOST RECENT reason is considered
  }
  return null
}

/** Which part of the day an hour belongs to (the same split the learner uses for "evenings have been harder"). */
export function partOfHour(hour: number): 'mornings' | 'afternoons' | 'evenings' | 'late nights' {
  if (hour >= 5 && hour < 12) return 'mornings'
  if (hour >= 12 && hour < 17) return 'afternoons'
  if (hour >= 17 && hour < 22) return 'evenings'
  return 'late nights'
}

const OBSERVATION = new Set(['photography', 'nature', 'mindfulness', 'stargazing', 'exploring', 'sketching', 'art', 'park', 'scavenger', 'sunset', 'waterfront'])
const MOVING = new Set(['cardio', 'sport', 'strength', 'running', 'cycling', 'swimming', 'workout', 'dance'])
const hasAny = (a: Activity, tags: Set<string>) => a.tags.some((t) => tags.has(t))

/**
 * How well an activity serves what the person said they want from THIS mission (clear my head, feel more energetic,
 * break the routine, feel connected). Only applies when they named one; "matched" is set only for a genuine fit, so the
 * explanation can truthfully say so.
 */
function outcomeComponent(activity: Activity, ctx: Context): { value: number; matched: DesiredOutcome | null } {
  const goal = ctx.desired_outcome
  if (!goal) return { value: 0, matched: null }
  let v = 0
  switch (goal) {
    case 'clear_head':
      v = (activity.motivators.includes('calm') ? 0.4 : 0) + (activity.intensity === 1 ? 0.2 : -0.3 * (activity.intensity - 1)) + (hasAny(activity, new Set(['mindfulness', 'nature', 'park', 'calm'])) ? 0.3 : 0)
      break
    case 'energise':
      v = (activity.intensity >= 2 ? 0.4 + 0.2 * (activity.intensity - 2) : -0.2) + (activity.family === 'movement' ? 0.2 : 0)
      break
    case 'break_routine':
      v = activity.novelty >= 3 ? 0.8 : activity.novelty === 2 ? 0.5 : -0.3
      break
    case 'connect': {
      const withOthers = activity.social.includes('with_friend') || activity.social.includes('small_group')
      v = (withOthers ? (ctx.social_available ? 0.6 : 0.1) : 0) + (activity.tags.some((t) => t === 'friends' || t === 'call' || t === 'talk') ? 0.3 : 0)
      break
    }
  }
  const value = clamp(v, -1, 1)
  return { value, matched: value >= 0.5 ? goal : null }
}

/**
 * Adjustments from what the assistant has LEARNED about the person (tentative patterns) and from their most recent
 * single answers (small nudges, never defining). Strong patterns count a bit more than tentative ones. The text returned
 * is the strongest reason this activity was helped, so the explanation can quote it.
 */
function learnedComponent(activity: Activity, ctx: Context, ordered: HistoryEvent[], own: HistoryEvent[]): { value: number; text: string | null } {
  let total = 0
  let best = { delta: 0, text: null as string | null }
  const add = (delta: number, text?: string) => {
    total += delta
    if (text && delta > best.delta) best = { delta, text }
  }
  const part = partOfHour(ctx.hour)
  const dur = activity.duration.default

  for (const s of ctx.learned ?? []) {
    const m = s.strength === 'consistent' ? 1.5 : 1
    switch (s.kind) {
      case 'enjoys_kind':
        if (s.key === activity.family) add(0.35 * m, s.text)
        break
      case 'hard_time': {
        const now = s.key === `part:${part}` || s.key === `day:${ctx.weekend ? 'weekend' : 'weekday'}`
        if (!now) break
        if (dur > 30) add(-0.35 * m)
        else if (dur <= 15) add(0.15 * m, `${s.text.replace(/\.$/, '')}, so this one is short.`)
        break
      }
      case 'duration_fit':
        if (s.key === 'short') (dur <= 20 ? add(0.3 * m, s.text) : dur > 40 ? add(-0.25 * m) : 0)
        else if (dur > 40) add(0.25 * m, s.text)
        break
      case 'barrier': {
        const helped =
          (s.key === 'couldnt_start' && dur <= 15) ||
          (s.key === 'too_tired' && (activity.tags.includes('seated') || activity.intensity === 1)) ||
          (s.key === 'no_time' && dur <= 20) ||
          (s.key === 'too_far' && activity.travel === 'none') ||
          (s.key === 'bad_weather' && activity.weather === 'any') ||
          (s.key === 'boring' && activity.novelty >= 2) ||
          (s.key === 'no_friend' && !activity.needsOthers) ||
          (s.key === 'too_costly' && activity.cost === 'free')
        if (helped) add(0.25 * m, s.text.replace(/\.$/, '') + ', so this one is easier.')
        break
      }
      case 'appeal':
        if (s.key === 'novelty') activity.novelty >= 2 ? add(0.3 * m, s.text) : add(-0.1 * m)
        else if (s.key === 'familiar') activity.novelty === 1 ? add(0.25 * m, s.text) : add(-0.1 * m)
        else if (s.key === 'company' && ctx.social_available && (activity.social.includes('with_friend') || activity.social.includes('small_group'))) add(0.3 * m, s.text)
        else if (s.key === 'solitude' && !activity.needsOthers && activity.social.includes('solo')) add(0.25 * m, s.text)
        else if (s.key === 'observation' && hasAny(activity, OBSERVATION) && !hasAny(activity, MOVING)) add(0.3 * m, s.text)
        else if (s.key === 'movement' && hasAny(activity, MOVING)) add(0.3 * m, s.text)
        else if (s.key === 'energising' && activity.intensity >= 2) add(0.25 * m, s.text)
        break
      case 'calming':
        if ((activity.motivators.includes('calm') || activity.tags.includes('mindfulness')) && activity.intensity === 1) add(0.35 * m, s.text)
        break
      case 'repetitive':
      case 'skipped_often':
        if (s.key === activity.id) add(-0.5 * m)
        break
      case 'no_change':
        if (s.key === activity.id) add(-0.35 * m)
        break
    }
  }

  // Single answers: small nudges. One answer is a hint, never a verdict.
  const lastRepeat = own.find((e) => e.would_repeat)?.would_repeat // own is newest-first
  if (lastRepeat === 'no') add(-0.6)
  else if (lastRepeat === 'yes') add(0.15)
  if (own.find((e) => e.feeling)?.feeling === 'same') add(-0.25)
  const recent = ordered.slice(0, 2)
  if (recent.some((e) => e.feeling === 'more_tired') && activity.intensity >= 2) add(-0.2)
  if (recent.some((e) => e.skip_reason === 'too_tired') && activity.tags.includes('seated')) add(0.4)
  if (recent.some((e) => e.skip_reason === 'couldnt_start' || e.barrier === 'couldnt_start') && dur <= 15) add(0.2)

  return { value: clamp(total, -1, 1), text: best.text }
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
    const outcome = outcomeComponent(activity, ctx)
    const learnedAdj = learnedComponent(activity, ctx, ordered, own)
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
      outcome_fit: outcome.value,
      learned: learnedAdj.value,
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
        declared_goal: pref.goal,
        outcome_fit: outcome.matched,
        learned_text: learnedAdj.text,
        ...enjoymentEvidence(own),
        addresses_skip: addressedSkip(activity, recent),
        recently_suggested: nov.recentlySuggested,
        history_size: ordered.length,
      },
    }
  })

  return scored.sort((a, b) => b.score - a.score || (a.activity.id < b.activity.id ? -1 : 1))
}
