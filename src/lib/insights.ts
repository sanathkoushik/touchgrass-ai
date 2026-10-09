import type { HistoryItem } from '@/shared/api'
import { getActivity } from '@/shared/engine'
import { hourOf } from '@/shared/engine/score'
import type { Family } from '@/shared/engine/types'
import { SKIP_REASON_LABELS } from './vocab'

/** Needs at least this many answered missions in a group before we say anything about it. */
const MIN_GROUP = 3

const PART_OF_DAY = [
  { id: 'mornings', from: 5, to: 12 },
  { id: 'afternoons', from: 12, to: 17 },
  { id: 'evenings', from: 17, to: 22 },
  { id: 'late nights', from: 22, to: 29 }, // wraps past midnight: 22:00 to 05:00
] as const

const FAMILY_LABEL: Record<Family, string> = { movement: 'movement', exploration: 'exploring', social_skill: 'social and skill' }

const partOf = (ts: string) => {
  const h = hourOf(ts)
  const hh = h < 5 ? h + 24 : h
  return PART_OF_DAY.find((p) => hh >= p.from && hh < p.to)?.id ?? 'evenings'
}

const done = (i: HistoryItem) => i.outcome === 'completed' || i.outcome === 'partial'

/**
 * Plain-language patterns, derived ONLY from the person's own answered missions. Each line carries its counts so it can
 * be checked against the list below it, and nothing is said until there is enough data to say it honestly.
 */
export function summarizeLearning(items: HistoryItem[]): string[] {
  const answered = items.filter((i) => i.outcome !== 'pending')
  const lines: string[] = []

  // When it works: the part of the day with the best completion, if it clearly beats the others.
  const byPart = new Map<string, { n: number; ok: number }>()
  for (const i of answered) {
    const g = byPart.get(partOf(i.timestamp)) ?? { n: 0, ok: 0 }
    g.n += 1
    if (done(i)) g.ok += 1
    byPart.set(partOf(i.timestamp), g)
  }
  const parts = [...byPart.entries()].filter(([, g]) => g.n >= MIN_GROUP).sort((a, b) => b[1].ok / b[1].n - a[1].ok / a[1].n)
  const best = parts[0]
  if (best && best[1].ok / best[1].n >= 0.5 && (parts.length === 1 || best[1].ok / best[1].n > parts[1]![1].ok / parts[1]![1].n)) {
    lines.push(`${cap(best[0])} work best for you: you did ${best[1].ok} of ${best[1].n}.`)
  }

  // What kind of thing: the family with the best completion.
  const byFamily = new Map<Family, { n: number; ok: number }>()
  for (const i of answered) {
    const f = getActivity(i.activity_id)?.family
    if (!f) continue
    const g = byFamily.get(f) ?? { n: 0, ok: 0 }
    g.n += 1
    if (done(i)) g.ok += 1
    byFamily.set(f, g)
  }
  const families = [...byFamily.entries()].filter(([, g]) => g.n >= MIN_GROUP).sort((a, b) => b[1].ok / b[1].n - a[1].ok / a[1].n)
  const topFamily = families[0]
  if (topFamily && topFamily[1].ok / topFamily[1].n >= 0.5 && (families.length === 1 || topFamily[1].ok / topFamily[1].n > families[1]![1].ok / families[1]![1].n)) {
    lines.push(`You follow through most on ${FAMILY_LABEL[topFamily[0]]}: ${topFamily[1].ok} of ${topFamily[1].n}.`)
  }

  // What gets in the way: the most common recorded reason, if it happened more than once.
  const reasons = new Map<string, number>()
  for (const i of answered) if (i.skip_reason) reasons.set(i.skip_reason, (reasons.get(i.skip_reason) ?? 0) + 1)
  const topReason = [...reasons.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]
  if (topReason && topReason[1] >= 2) {
    lines.push(`What gets in the way most: ${SKIP_REASON_LABELS[topReason[0] as keyof typeof SKIP_REASON_LABELS].toLowerCase()} (${topReason[1]} times).`)
  }

  // What you enjoy: the best-rated activity with at least two ratings.
  const rated = new Map<string, { title: string; sum: number; n: number }>()
  for (const i of answered) {
    if (!done(i) || i.enjoyment === null) continue
    const g = rated.get(i.activity_id) ?? { title: i.title, sum: 0, n: 0 }
    g.sum += i.enjoyment
    g.n += 1
    rated.set(i.activity_id, g)
  }
  const fav = [...rated.values()].filter((g) => g.n >= 2).sort((a, b) => b.sum / b.n - a.sum / a.n || (a.title < b.title ? -1 : 1))[0]
  if (fav && fav.sum / fav.n >= 4) lines.push(`You rate "${fav.title}" highest: ${(fav.sum / fav.n).toFixed(1)} out of 5 over ${fav.n} times.`)

  return lines
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
