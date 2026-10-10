import { getActivity } from './engine/activities'
import type { Family, Outcome, SocialMode } from './engine/types'

/**
 * The Meadow: how the app says "well done" without ever scolding.
 *
 * Everything here is computed from the person's own answers; nothing is invented, and nothing is ever taken away:
 *  - a mission only ever ADDS time outside; skipping a day costs nothing (no streaks, no points to lose);
 *  - milestones are earned once and kept forever.
 * Pure TypeScript with no zod, so the Worker, the browser (offline) and the tests share one definition.
 */

export interface MeadowEvent {
  activity_id: string
  /** The person's local wall-clock time with offset, e.g. "2026-10-07T17:42:00+05:30". */
  timestamp: string
  outcome: Outcome | 'pending'
  enjoyment?: number
  /** Minutes the person was away from the app between "Let's go" and "I am back" (or what they said). */
  minutes_outside?: number
  quests_done?: number
  /** What the app planned for this mission. */
  planned_min?: number
  /** Who it was done with. */
  social_mode?: SocialMode
  /** They wrote something down (a memory). The text itself is not needed here. */
  has_note?: boolean
  /** They attached a photo (it stays on their device). */
  has_photo?: boolean
}

const isCredited = (e: MeadowEvent) => e.outcome === 'completed' || e.outcome === 'partial'

/**
 * Minutes this mission adds to the meadow. Honest by construction:
 *  - only completed or partial missions count;
 *  - the measured/stated time outside is used when there is one, else the plan (half of it for "part of it");
 *  - capped at 1.5x the plan (at least 15 min), so a phone left on a shelf overnight cannot inflate anything.
 */
export function creditedMinutes(e: MeadowEvent): number {
  if (!isCredited(e)) return 0
  const planned = e.planned_min ?? getActivity(e.activity_id)?.duration.default ?? 20
  const base = e.minutes_outside ?? Math.round(planned * (e.outcome === 'completed' ? 1 : 0.5))
  const cap = Math.max(15, Math.round(planned * 1.5))
  return Math.max(1, Math.min(Math.round(base), cap))
}

// ------------------------------------------------------------------ milestones

export const MILESTONE_IDS = [
  'first_step',
  'hour_out',
  'five_hours',
  'day_out',
  'ten_missions',
  'twentyfive_missions',
  'all_kinds',
  'variety',
  'early_start',
  'evening_out',
  'comeback',
  'quester',
  'loved_it',
  'honest_checkins',
  'memory_keeper',
  'grown_to_enjoy',
  'connected',
] as const
export type MilestoneId = (typeof MILESTONE_IDS)[number]

export interface Milestone {
  id: MilestoneId
  title: string
  description: string
  earned: boolean
  /** The local time of the mission that earned it. */
  earned_at: string | null
  progress?: { current: number; target: number }
}

interface Totals {
  minutes: number
  missions: number
  quests: number
  families: Set<Family>
  activities: Set<string>
  loved: number
  early: boolean
  evening: boolean
  comeback: boolean
  /** Honest check-ins: missions that did not happen (or happened differently) and were reported anyway. */
  seeds: number
  keepsakes: number
  social: number
  /** Activities they have grown to enjoy (3+ times, rated 4 or more on average). */
  trees: Set<string>
}

interface Def {
  id: MilestoneId
  title: string
  description: string
  /** Numeric progress, if the milestone has a target. */
  progress?: (t: Totals) => { current: number; target: number }
  /** Is it earned given everything up to and including the latest mission? */
  test: (t: Totals) => boolean
}

const DEFS: Def[] = [
  { id: 'first_step', title: 'First step outside', description: 'Your first mission, done.', test: (t) => t.missions >= 1 },
  {
    id: 'hour_out',
    title: 'An hour outside',
    description: 'Sixty minutes outside, added up.',
    progress: (t) => ({ current: Math.min(t.minutes, 60), target: 60 }),
    test: (t) => t.minutes >= 60,
  },
  {
    id: 'five_hours',
    title: 'Five hours outside',
    description: 'Five hours of real life, one mission at a time.',
    progress: (t) => ({ current: Math.min(t.minutes, 300), target: 300 }),
    test: (t) => t.minutes >= 300,
  },
  {
    id: 'day_out',
    title: 'A whole day outside',
    description: 'Twenty-four hours, spread across your missions.',
    progress: (t) => ({ current: Math.min(t.minutes, 1440), target: 1440 }),
    test: (t) => t.minutes >= 1440,
  },
  {
    id: 'ten_missions',
    title: 'Ten missions',
    description: 'You have gone ten times.',
    progress: (t) => ({ current: Math.min(t.missions, 10), target: 10 }),
    test: (t) => t.missions >= 10,
  },
  {
    id: 'twentyfive_missions',
    title: 'Twenty-five missions',
    description: 'Twenty-five times you chose outside.',
    progress: (t) => ({ current: Math.min(t.missions, 25), target: 25 }),
    test: (t) => t.missions >= 25,
  },
  {
    id: 'all_kinds',
    title: 'A bit of everything',
    description: 'You have moved, explored and done something social or skilled.',
    progress: (t) => ({ current: t.families.size, target: 3 }),
    test: (t) => t.families.size >= 3,
  },
  {
    id: 'variety',
    title: 'Five different things',
    description: 'Five different activities, not the same walk five times.',
    progress: (t) => ({ current: Math.min(t.activities.size, 5), target: 5 }),
    test: (t) => t.activities.size >= 5,
  },
  { id: 'early_start', title: 'Early start', description: 'A mission before 9 in the morning.', test: (t) => t.early },
  { id: 'evening_out', title: 'An evening outside', description: 'A mission between 5 and 8 in the evening.', test: (t) => t.evening },
  { id: 'comeback', title: 'Welcome back', description: 'You went out again after a week or more away. No catching up needed.', test: (t) => t.comeback },
  {
    id: 'quester',
    title: 'Side-quest finder',
    description: 'Ten of the little prompts tried along the way.',
    progress: (t) => ({ current: Math.min(t.quests, 10), target: 10 }),
    test: (t) => t.quests >= 10,
  },
  {
    id: 'honest_checkins',
    title: 'Honest check-ins',
    description: 'You told us the truth three times, even when it did not go to plan. That helps more than a perfect record.',
    progress: (t) => ({ current: Math.min(t.seeds, 3), target: 3 }),
    test: (t) => t.seeds >= 3,
  },
  { id: 'memory_keeper', title: 'Kept a memory', description: 'You wrote something down, or kept a photo, to remember a mission by.', test: (t) => t.keepsakes >= 1 },
  { id: 'grown_to_enjoy', title: 'Grown to enjoy it', description: 'Something you have done three times and rated highly now has a tree in your meadow.', test: (t) => t.trees.size >= 1 },
  { id: 'connected', title: 'Better together', description: 'You did a mission with someone else.', test: (t) => t.social >= 1 },
  {
    id: 'loved_it',
    title: 'Three great ones',
    description: 'Three missions you rated 5 out of 5.',
    progress: (t) => ({ current: Math.min(t.loved, 3), target: 3 }),
    test: (t) => t.loved >= 3,
  },
]

const hourOf = (ts: string): number => {
  const h = Number.parseInt(ts.slice(11, 13), 10)
  return Number.isFinite(h) ? h : 12
}

/** Whole days between two local timestamps' calendar dates. */
function daysBetween(a: string, b: string): number {
  const ms = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)))
  return Math.round((ms(b) - ms(a)) / 86_400_000)
}

/** Oldest first, so "earned at" is the mission that really crossed the line. */
const chronological = (events: MeadowEvent[]) => [...events].sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0))

function walkMilestones(events: MeadowEvent[]): { milestones: Milestone[]; totals: Totals } {
  const totals: Totals = {
    minutes: 0,
    missions: 0,
    quests: 0,
    families: new Set(),
    activities: new Set(),
    loved: 0,
    early: false,
    evening: false,
    comeback: false,
    seeds: 0,
    keepsakes: 0,
    social: 0,
    trees: new Set(),
  }
  const ratingsBy = new Map<string, number[]>()
  const doneBy = new Map<string, number>()
  const earnedAt = new Map<MilestoneId, string>()
  let lastTs: string | null = null

  const check = (ts: string) => {
    for (const d of DEFS) if (!earnedAt.has(d.id) && d.test(totals)) earnedAt.set(d.id, ts)
  }

  for (const e of chronological(events)) {
    if (e.outcome === 'pending') continue
    if (!isCredited(e)) {
      // Telling us it did not happen is honest, and it is recognised (a seed), but it never adds time.
      totals.seeds += 1
      check(e.timestamp)
      continue
    }
    totals.minutes += creditedMinutes(e)
    totals.missions += 1
    totals.quests += e.quests_done ?? 0
    const family = getActivity(e.activity_id)?.family
    if (family) totals.families.add(family)
    totals.activities.add(e.activity_id)
    if (e.enjoyment === 5) totals.loved += 1
    if (e.has_note || e.has_photo) totals.keepsakes += 1
    if (e.social_mode === 'with_friend' || e.social_mode === 'small_group') totals.social += 1
    doneBy.set(e.activity_id, (doneBy.get(e.activity_id) ?? 0) + 1)
    if (typeof e.enjoyment === 'number') ratingsBy.set(e.activity_id, [...(ratingsBy.get(e.activity_id) ?? []), e.enjoyment])
    const r = ratingsBy.get(e.activity_id) ?? []
    if ((doneBy.get(e.activity_id) ?? 0) >= 3 && r.length >= 2 && r.reduce((a, b) => a + b, 0) / r.length >= 4) totals.trees.add(e.activity_id)
    const h = hourOf(e.timestamp)
    if (h >= 5 && h < 9) totals.early = true
    if (h >= 17 && h < 20) totals.evening = true
    if (lastTs !== null && daysBetween(lastTs, e.timestamp) >= 7) totals.comeback = true
    lastTs = e.timestamp
    check(e.timestamp)
  }

  const milestones: Milestone[] = DEFS.map((d) => ({
    id: d.id,
    title: d.title,
    description: d.description,
    earned: earnedAt.has(d.id),
    earned_at: earnedAt.get(d.id) ?? null,
    ...(d.progress ? { progress: d.progress(totals) } : {}),
  }))
  return { milestones, totals }
}

/** Milestones that exist in `after` but not in `before` (what a mission just earned). */
export function newMilestones(before: MeadowEvent[], after: MeadowEvent[]): Milestone[] {
  const was = new Set(walkMilestones(before).milestones.filter((m) => m.earned).map((m) => m.id))
  return walkMilestones(after).milestones.filter((m) => m.earned && !was.has(m.id))
}

// ------------------------------------------------------------------ the summary

export interface MeadowDay {
  /** Local calendar date, "2026-10-07". */
  date: string
  minutes: number
}

export interface MeadowSummary {
  total_minutes: number
  missions: number
  quests_done: number
  minutes_by_family: Record<Family, number>
  /** One flower per credited mission (newest last), by kind, capped for drawing. */
  flowers: Family[]
  week: {
    /** The last 7 local days, oldest first, ending today. */
    days: MeadowDay[]
    minutes: number
    last_week_minutes: number
  }
  milestones: Milestone[]
  /** The unearned milestone you are closest to, if any. */
  next: Milestone | null
  favourite: { activity_id: string; title: string; count: number } | null
  /** What the meadow holds besides grass and flowers: a record of experiences, not a score. */
  garden: Garden
}

export interface Garden {
  /** Things they have grown to enjoy: done three times and rated highly. One tree each. */
  trees: { activity_id: string; title: string; family: Family }[]
  /** Missions they kept a memory of (a note or a photo). */
  keepsakes: number
  /** Missions done with other people. */
  social_tokens: number
  /** Honest check-ins: it did not happen, and they said so. */
  seeds: number
  /** Patterns the assistant guessed that the person confirmed as true for them. */
  lessons: number
}

const MAX_FLOWERS = 60

/** "2026-10-07" for a moment, in the person's own clock. */
export function localDate(at: Date, offsetMinutes: number): string {
  return new Date(at.getTime() + offsetMinutes * 60_000).toISOString().slice(0, 10)
}

function shiftDate(date: string, days: number): string {
  const d = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))))
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** `lessons` = how many learned patterns the person has confirmed (kept in their profile, not derived from missions). */
export function computeMeadow(events: MeadowEvent[], today: string, lessons = 0): MeadowSummary {
  const { milestones, totals } = walkMilestones(events)
  const credited = chronological(events).filter(isCredited)

  const byFamily: Record<Family, number> = { movement: 0, exploration: 0, social_skill: 0 }
  const byDate = new Map<string, number>()
  const counts = new Map<string, number>()
  const flowers: Family[] = []
  for (const e of credited) {
    const m = creditedMinutes(e)
    const family = getActivity(e.activity_id)?.family
    if (family) {
      byFamily[family] += m
      flowers.push(family)
    }
    const date = e.timestamp.slice(0, 10)
    byDate.set(date, (byDate.get(date) ?? 0) + m)
    counts.set(e.activity_id, (counts.get(e.activity_id) ?? 0) + 1)
  }

  const days: MeadowDay[] = Array.from({ length: 7 }, (_, i) => {
    const date = shiftDate(today, i - 6)
    return { date, minutes: byDate.get(date) ?? 0 }
  })
  let lastWeek = 0
  for (let i = 7; i < 14; i++) lastWeek += byDate.get(shiftDate(today, -i)) ?? 0

  const unearned = milestones.filter((m) => !m.earned && m.progress)
  const next = unearned.sort((a, b) => b.progress!.current / b.progress!.target - a.progress!.current / a.progress!.target)[0] ?? null

  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]
  const favourite = top && top[1] >= 2 ? { activity_id: top[0], title: getActivity(top[0])?.title ?? top[0], count: top[1] } : null

  return {
    total_minutes: totals.minutes,
    missions: totals.missions,
    quests_done: totals.quests,
    minutes_by_family: byFamily,
    flowers: flowers.slice(-MAX_FLOWERS),
    week: { days, minutes: days.reduce((s, d) => s + d.minutes, 0), last_week_minutes: lastWeek },
    milestones,
    next,
    favourite,
    garden: {
      trees: [...totals.trees].sort().map((id) => ({ activity_id: id, title: getActivity(id)?.title ?? id, family: getActivity(id)?.family ?? 'movement' })),
      keepsakes: totals.keepsakes,
      social_tokens: totals.social,
      seeds: totals.seeds,
      lessons: Math.max(0, Math.round(lessons)),
    },
  }
}

/** What a mission just added, shown on the celebration screen. */
export interface RewardSummary {
  credited_minutes: number
  total_minutes: number
  missions: number
  quests_done: number
  new_milestones: Milestone[]
}

/** "1 h 20 min", "45 min", "3 h". */
export function formatMinutes(total: number): string {
  const m = Math.max(0, Math.round(total))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r === 0 ? `${h} h` : `${h} h ${r} min`
}
