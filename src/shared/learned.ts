import { getActivity } from './engine/activities'
import { partOfHour } from './engine/score'
import type { PlanPrefill } from './next-step'
import type {
  Activity,
  Family,
  Feeling,
  Helper,
  LearnedSignal,
  Outcome,
  SkipReason,
  SocialMode,
  WouldRepeat,
} from './engine/types'

/**
 * What the assistant has noticed about the person, from their own answers only.
 *
 * Rules this file enforces (from the product principles):
 *  - patterns are TENTATIVE: they need several answers, and the wording says "seems" / "so far";
 *  - one unsuccessful attempt never defines anyone (minimum sample sizes everywhere);
 *  - the person can confirm, dismiss or reset any of it (the controls live in the profile; this file just computes);
 *  - no medical or psychological claims, no labels: only plain observations about what they chose and how it went;
 *  - nothing is stored here: it is recomputed from the answers each time.
 */

/** One answered mission, as the learner needs it. */
export interface LearnEvent {
  activity_id: string
  /** The person's local wall-clock time, e.g. "2026-10-07T17:42:00+05:30". */
  timestamp: string
  outcome: Outcome | 'pending'
  enjoyment?: number
  planned_min?: number
  skip_reason?: SkipReason
  barrier?: SkipReason
  helper?: Helper
  feeling?: Feeling
  would_repeat?: WouldRepeat
  social_mode?: SocialMode
  /** UTC ISO time they answered (for "reset what you have learned"). */
  responded_at?: string
}

export interface LearnedItem extends LearnedSignal {
  /** How we know: the real numbers behind the sentence. */
  evidence: string
  samples: number
}

export interface LearnControls {
  /** Events answered at or before this UTC time are ignored ("start learning from scratch"). */
  reset_at?: string
}

// ------------------------------------------------------------------ thresholds
// Deliberately conservative: it is better to say nothing than to say something wrong about a person.
const MIN_RATINGS = 2
const MIN_GROUP = 3
const MIN_PART = 4
const CONSISTENT_AT = 6
const MAX_ITEMS = 12

const isCredited = (e: LearnEvent) => e.outcome === 'completed' || e.outcome === 'partial'
const isDeclined = (e: LearnEvent) => e.outcome === 'skipped' || e.outcome === 'changed'

export const PARTS = ['mornings', 'afternoons', 'evenings', 'late nights'] as const
export type Part = (typeof PARTS)[number]

export function partOfDay(timestamp: string): Part {
  const h = Number.parseInt(timestamp.slice(11, 13), 10)
  return partOfHour(Number.isFinite(h) ? h : 12)
}

/** Weekend by the calendar date in the timestamp itself (the person's own date, whatever time zone this runs in). */
export function isWeekend(timestamp: string): boolean {
  const d = new Date(`${timestamp.slice(0, 10)}T12:00:00Z`).getUTCDay()
  return d === 0 || d === 6
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const round1 = (n: number) => Math.round(n * 10) / 10
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const FAMILY_TEXT: Record<Family, string> = {
  movement: 'You seem to enjoy active, moving missions.',
  exploration: 'You seem to enjoy exploring and discovering new things more than repeating the same route.',
  social_skill: 'You seem to enjoy social and skill-based missions.',
}

const BARRIER_TEXT: Partial<Record<SkipReason, string>> = {
  couldnt_start: 'Getting started has often been the hardest part.',
  too_tired: 'Low energy has often been what gets in the way.',
  no_time: 'Not having enough time has come up a few times.',
  bad_weather: 'Weather has got in the way a few times.',
  too_far: 'Distance has put you off a few times.',
  boring: 'Some missions have felt dull to you.',
  no_friend: 'Not having company has come up more than once.',
  too_costly: 'Cost has come up more than once.',
}

/** Activities that are mostly about noticing and being somewhere, versus mostly about moving. */
const OBSERVATION_TAGS = new Set(['photography', 'nature', 'mindfulness', 'stargazing', 'exploring', 'sketching', 'art', 'park', 'scavenger', 'sunset', 'waterfront'])
const MOVEMENT_TAGS = new Set(['cardio', 'sport', 'strength', 'running', 'cycling', 'swimming', 'workout', 'dance'])

const hasTag = (a: Activity, tags: Set<string>) => a.tags.some((t) => tags.has(t))
const title = (id: string) => getActivity(id)?.title ?? 'this one'
const strengthOf = (samples: number): 'tentative' | 'consistent' => (samples >= CONSISTENT_AT ? 'consistent' : 'tentative')

function item(kind: LearnedItem['kind'], key: string, text: string, evidence: string, samples: number): LearnedItem {
  return { id: `${kind}:${key}`, kind, key, strength: strengthOf(samples), text, evidence, samples }
}

/** All the patterns the answers support, strongest first. The caller decides which the person has dismissed. */
export function learnProfile(events: LearnEvent[], controls: LearnControls = {}): LearnedItem[] {
  const resetAt = controls.reset_at
  const all = events
    .filter((e) => e.outcome !== 'pending')
    .filter((e) => !resetAt || !e.responded_at || e.responded_at > resetAt)
    .sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0))
  if (all.length === 0) return []

  const credited = all.filter(isCredited)
  const rated = credited.filter((e) => typeof e.enjoyment === 'number')
  const out: LearnedItem[] = []

  // ---- which kinds of mission they enjoy after trying them
  const byFamily = new Map<Family, number[]>()
  for (const e of rated) {
    const f = getActivity(e.activity_id)?.family
    if (f) byFamily.set(f, [...(byFamily.get(f) ?? []), e.enjoyment!])
  }
  const families = [...byFamily.entries()].filter(([, r]) => r.length >= MIN_RATINGS).map(([f, r]) => ({ f, n: r.length, a: avg(r) }))
  const bestFamily = families.sort((x, y) => y.a - x.a || y.n - x.n)[0]
  if (bestFamily && bestFamily.a >= 4) {
    const others = families.filter((x) => x.f !== bestFamily.f)
    if (others.every((o) => bestFamily.a - o.a >= 0.5)) {
      out.push(item('enjoys_kind', bestFamily.f, FAMILY_TEXT[bestFamily.f], `Based on ${plural(bestFamily.n, 'mission', 'missions')} you rated, averaging ${round1(bestFamily.a)} out of 5.`, bestFamily.n))
    }
  }

  // ---- which times of day make starting easier or harder
  const parts = new Map<Part, { n: number; started: number }>()
  for (const e of all) {
    const p = partOfDay(e.timestamp)
    const cur = parts.get(p) ?? { n: 0, started: 0 }
    cur.n += 1
    if (isCredited(e)) cur.started += 1
    parts.set(p, cur)
  }
  for (const [p, { n, started }] of parts) {
    if (n < MIN_PART) continue
    const rate = started / n
    if (rate >= 0.75) out.push(item('easy_time', `part:${p}`, `Starting tends to come easier in the ${p}.`, `You started ${started} of ${n} missions planned in the ${p}.`, n))
    else if (rate <= 0.34) out.push(item('hard_time', `part:${p}`, `${cap(p)} have been harder to start.`, `You started ${started} of ${n} missions planned in the ${p}.`, n))
  }

  // ---- weekend versus weekday (only when both have enough answers and they genuinely differ)
  const day = { weekend: { n: 0, started: 0 }, weekday: { n: 0, started: 0 } }
  for (const e of all) {
    const d = isWeekend(e.timestamp) ? day.weekend : day.weekday
    d.n += 1
    if (isCredited(e)) d.started += 1
  }
  if (day.weekend.n >= MIN_GROUP && day.weekday.n >= MIN_GROUP) {
    const we = day.weekend.started / day.weekend.n
    const wd = day.weekday.started / day.weekday.n
    if (Math.abs(we - wd) >= 0.4) {
      const [hi, lo, hiKey, loKey] = we > wd ? [day.weekend, day.weekday, 'weekend', 'weekday'] : [day.weekday, day.weekend, 'weekday', 'weekend']
      out.push(item('easy_time', `day:${hiKey}`, `Starting tends to come easier on ${hiKey === 'weekend' ? 'weekends' : 'weekdays'}.`, `You started ${hi.started} of ${hi.n} on ${hiKey === 'weekend' ? 'weekends' : 'weekdays'}, against ${lo.started} of ${lo.n} on ${loKey === 'weekend' ? 'weekends' : 'weekdays'}.`, hi.n + lo.n))
      out.push(item('hard_time', `day:${loKey}`, `${cap(loKey === 'weekend' ? 'weekends' : 'weekdays')} have been harder to start.`, `You started ${lo.started} of ${lo.n} on ${loKey === 'weekend' ? 'weekends' : 'weekdays'}.`, lo.n))
    }
  }

  // ---- which durations feel manageable
  const bandOf = (e: LearnEvent) => {
    const m = e.planned_min ?? getActivity(e.activity_id)?.duration.default ?? 30
    return m <= 15 ? 'short' : m <= 40 ? 'medium' : 'long'
  }
  const bands = { short: { n: 0, started: 0 }, medium: { n: 0, started: 0 }, long: { n: 0, started: 0 } }
  for (const e of all) {
    const b = bands[bandOf(e)]
    b.n += 1
    if (isCredited(e)) b.started += 1
  }
  const rate = (b: { n: number; started: number }) => (b.n >= MIN_GROUP ? b.started / b.n : null)
  const [rs, rm, rl] = [rate(bands.short), rate(bands.medium), rate(bands.long)]
  if (rs !== null && rs >= 0.7 && ((rl !== null && rl <= 0.4) || (rm !== null && rm <= 0.4))) {
    out.push(item('duration_fit', 'short', 'Shorter missions seem to feel more manageable for you.', `You started ${bands.short.started} of ${bands.short.n} short ones (15 minutes or less).`, bands.short.n))
  } else if (rl !== null && rl >= 0.7 && rs !== null && rs <= 0.4) {
    out.push(item('duration_fit', 'long', 'Longer missions seem to work well for you.', `You started ${bands.long.started} of ${bands.long.n} longer ones (over 40 minutes).`, bands.long.n))
  }

  // ---- common barriers to starting (said when declining, or when something made a mission harder)
  const barrierCounts = new Map<SkipReason, number>()
  for (const e of all) {
    const reason = isDeclined(e) ? e.skip_reason : e.barrier
    if (reason && reason !== 'other') barrierCounts.set(reason, (barrierCounts.get(reason) ?? 0) + 1)
  }
  for (const [reason, n] of [...barrierCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2)) {
    const text = BARRIER_TEXT[reason]
    if (text && n >= 2) out.push(item('barrier', reason, text, `You mentioned this ${n} times.`, n))
  }

  // ---- what appeals: novelty, company or solitude, noticing things, moving
  const compare = (isA: (e: LearnEvent, a: Activity) => boolean, isB: (e: LearnEvent, a: Activity) => boolean) => {
    const A: number[] = []
    const B: number[] = []
    for (const e of rated) {
      const a = getActivity(e.activity_id)
      if (!a) continue
      if (isA(e, a)) A.push(e.enjoyment!)
      else if (isB(e, a)) B.push(e.enjoyment!)
    }
    return A.length >= MIN_RATINGS && B.length >= MIN_RATINGS ? { a: avg(A), b: avg(B), nA: A.length, nB: B.length } : null
  }
  const novelty = compare((_e, a) => a.novelty >= 2, (_e, a) => a.novelty <= 1)
  if (novelty && novelty.a - novelty.b >= 0.6) out.push(item('appeal', 'novelty', 'New things seem to appeal to you more than familiar routines.', `You rated new-feeling missions ${round1(novelty.a)} on average, against ${round1(novelty.b)} for familiar ones.`, novelty.nA + novelty.nB))
  else if (novelty && novelty.b - novelty.a >= 0.6) out.push(item('appeal', 'familiar', 'Familiar routines seem to suit you better than new things.', `You rated familiar missions ${round1(novelty.b)} on average, against ${round1(novelty.a)} for new-feeling ones.`, novelty.nA + novelty.nB))

  const company = compare((e) => e.social_mode === 'with_friend' || e.social_mode === 'small_group', (e) => e.social_mode === 'solo')
  if (company && company.a - company.b >= 0.6) out.push(item('appeal', 'company', 'Missions with other people seem to appeal to you more than doing them alone.', `You rated missions with company ${round1(company.a)} on average, against ${round1(company.b)} alone.`, company.nA + company.nB))
  else if (company && company.b - company.a >= 0.6) out.push(item('appeal', 'solitude', 'Time on your own seems to suit you well.', `You rated missions alone ${round1(company.b)} on average, against ${round1(company.a)} with company.`, company.nA + company.nB))

  const observing = compare((_e, a) => hasTag(a, OBSERVATION_TAGS) && !hasTag(a, MOVEMENT_TAGS), (_e, a) => hasTag(a, MOVEMENT_TAGS))
  const noticed = credited.filter((e) => e.helper === 'noticing_things').length
  if ((observing && observing.a - observing.b >= 0.6) || noticed >= 2) {
    out.push(item('appeal', 'observation', 'Noticing things around you seems to appeal to you.', noticed >= 2 ? `You said noticing things made ${plural(noticed, 'mission', 'missions')} easier.` : `You rated noticing-style missions ${round1(observing!.a)} on average, against ${round1(observing!.b)} for movement-style ones.`, noticed >= 2 ? noticed : observing!.nA + observing!.nB))
  } else if (observing && observing.b - observing.a >= 0.6) {
    out.push(item('appeal', 'movement', 'Moving your body seems to appeal to you more than slow, watching-style missions.', `You rated movement missions ${round1(observing.b)} on average, against ${round1(observing.a)} for noticing-style ones.`, observing.nA + observing.nB))
  }

  // ---- how they feel afterwards
  const felt = credited.filter((e) => e.feeling)
  const calmer = felt.filter((e) => e.feeling === 'calmer').length
  if (calmer >= 2 && calmer / felt.length >= 0.5) out.push(item('calming', 'calmer', 'Quiet, slow missions seem to leave you feeling calmer.', `You felt calmer after ${calmer} of ${felt.length} missions where you said how you felt.`, calmer))
  const energised = felt.filter((e) => e.feeling === 'more_energetic').length
  if (energised >= 2 && energised / felt.length >= 0.5) out.push(item('appeal', 'energising', 'Active missions seem to leave you feeling more energetic.', `You felt more energetic after ${energised} of ${felt.length} missions where you said how you felt.`, energised))

  // ---- repetition, repeated skips, no change
  const byActivity = new Map<string, LearnEvent[]>()
  for (const e of all) byActivity.set(e.activity_id, [...(byActivity.get(e.activity_id) ?? []), e])
  for (const [id, list] of byActivity) {
    const done = list.filter(isCredited)
    const ratings = done.filter((e) => typeof e.enjoyment === 'number').map((e) => e.enjoyment!)
    const lastRepeat = [...done].reverse().find((e) => e.would_repeat)?.would_repeat
    const slipping = ratings.length >= 2 && ratings[0]! - ratings[ratings.length - 1]! >= 1
    if (done.length >= 3 && (lastRepeat === 'no' || lastRepeat === 'maybe' || slipping)) {
      out.push(item('repetitive', id, `${title(id)} may be getting repetitive.`, `You have done it ${done.length} times${slipping ? ' and rated the latest lower than the first' : lastRepeat ? ` and last said "${lastRepeat}" to doing it again` : ''}.`, done.length))
    }
    const last4 = list.slice(-4)
    const declined = last4.filter(isDeclined).length
    if (last4.length >= MIN_GROUP && declined >= 2) {
      out.push(item('skipped_often', id, `You have skipped or swapped ${title(id)} a few times.`, `${declined} of your last ${last4.length} answers about it were a skip or a swap.`, declined))
    } else if (list.length >= 1 && [...list].reverse().find((e) => e.would_repeat)?.would_repeat === 'no' && done.length >= 1) {
      out.push(item('skipped_often', id, `You said you would rather not do ${title(id)} again.`, 'You told us this after doing it.', 1))
    }
    const same = done.filter((e) => e.feeling === 'same').length
    if (same >= 2) out.push(item('no_change', id, `${title(id)} does not seem to change how you feel.`, `You felt about the same after it ${same} times.`, same))
  }

  // Strongest first; cap so the list stays readable.
  return out.sort((a, b) => (a.strength === b.strength ? b.samples - a.samples : a.strength === 'consistent' ? -1 : 1)).slice(0, MAX_ITEMS)
}

/** The wording shown beside the controls: what is learned, how it is used, and what the person can do about it. */
export const LEARNING_EXPLANATION =
  'These are guesses from the answers you gave after missions, nothing more. They are used only to choose and explain what to suggest next, and they change as you answer. You can confirm one, say it is not true, or start again from scratch. Learning only uses what you told us here: no device sensors, no location history, no diagnosis of any kind.'

/**
 * The patterns the engine may use, minus anything the person dismissed.
 * (A dismissed pattern is never used and never shown again until they restore it or reset.)
 */
export function usableSignals(items: LearnedItem[], dismissed: readonly string[] = []): LearnedSignal[] {
  const gone = new Set(dismissed)
  return items.filter((i) => !gone.has(i.id)).map(({ id, kind, key, strength, text }) => ({ id, kind, key, strength, text }))
}

/**
 * One kind thing the assistant noticed that fits RIGHT NOW, with a one-tap way to try it. Never pushy: it only appears
 * when a pattern matches this moment, it names the pattern in plain words, and it offers something small.
 */
export function suggestFromLearned(items: LearnedItem[], now: { hour: number; weekend: boolean }): { text: string; plan: PlanPrefill } | null {
  const part = partOfHour(now.hour)
  const hard = items.find((i) => i.kind === 'hard_time' && (i.key === `part:${part}` || i.key === `day:${now.weekend ? 'weekend' : 'weekday'}`))
  if (hard) {
    const easy = items.find((i) => i.kind === 'easy_time' && i.key !== hard.key)
    return {
      text: `${hard.text} ${easy ? `${easy.text} ` : ''}Want to try something short right now?`,
      plan: { duration_limit: 15, mode: 'minimum' },
    }
  }
  const start = items.find((i) => i.kind === 'barrier' && i.key === 'couldnt_start')
  if (start) return { text: `${start.text} Want to try a two-minute start?`, plan: { duration_limit: 5, mode: 'minimum', mood: 'low' } }
  return null
}
