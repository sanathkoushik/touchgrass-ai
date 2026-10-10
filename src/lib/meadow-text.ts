import { formatMinutes, type Milestone, type MilestoneId } from '@/shared/meadow'

/** How far away a milestone is, in the right unit for it: "40 min to go". */
export function remainingText(m: Milestone): string | null {
  if (!m.progress || m.earned) return null
  const left = Math.max(0, m.progress.target - m.progress.current)
  if (left === 0) return null
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  const unit: Partial<Record<MilestoneId, string>> = {
    hour_out: formatMinutes(left),
    five_hours: formatMinutes(left),
    day_out: formatMinutes(left),
    ten_missions: plural(left, 'more mission', 'more missions'),
    twentyfive_missions: plural(left, 'more mission', 'more missions'),
    all_kinds: plural(left, 'more kind of activity', 'more kinds of activity'),
    variety: plural(left, 'more different activity', 'more different activities'),
    quester: plural(left, 'more side quest', 'more side quests'),
    loved_it: plural(left, 'more 5 out of 5', 'more 5 out of 5s'),
    honest_checkins: plural(left, 'more honest check-in', 'more honest check-ins'),
  }
  const u = unit[m.id]
  return u ? `${u} to go` : null
}

/** What to say when a mission is finished. Warm, specific, never a comparison with other people. */
export function celebrationHeadline(outcome: 'completed' | 'partial', enjoyment: number | null): string {
  if (outcome === 'partial') return 'Part of it still counts.'
  if (enjoyment === 5) return 'You loved that one. Remember it.'
  return 'That was real. Nicely done.'
}

/** "Mon", "Tue"... for a local calendar date like "2026-10-07" (calendar math only, so no time zone can shift it). */
export function weekdayShort(date: string): string {
  return new Intl.DateTimeFormat('en', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))
}

/** "Wed 7 Oct" for a local timestamp such as "2026-10-07T17:42:00+05:30" (shows the person's own clock date). */
export function earnedOn(timestamp: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(timestamp)
  if (!m) return ''
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00Z`))
}
