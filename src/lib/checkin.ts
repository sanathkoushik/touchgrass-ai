import type { DesiredOutcome, Mood } from '@/shared/engine/types'
import { DESIRED_OUTCOMES } from '@/shared/engine/types'

/**
 * The daily check-in, kept short on purpose. We only ask what we do not already know, and only when it is worth the
 * person's time: what they said last time is remembered (in this browser only), and with very little time we ask nothing
 * extra at all.
 */

export type Company = 'alone' | 'together' | 'either'
export const COMPANY_CHOICES: readonly Company[] = ['alone', 'together', 'either']

export interface CheckinMemory {
  company?: Company
  /** null = "no preference", explicitly chosen. Undefined = never answered. */
  outcome?: DesiredOutcome | null
  mood?: Mood
}

const KEY = 'tg_checkin'

export function loadCheckin(): CheckinMemory {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const p = JSON.parse(raw) as Record<string, unknown>
    const out: CheckinMemory = {}
    if (COMPANY_CHOICES.includes(p.company as Company)) out.company = p.company as Company
    if (p.outcome === null) out.outcome = null
    else if (DESIRED_OUTCOMES.includes(p.outcome as DesiredOutcome)) out.outcome = p.outcome as DesiredOutcome
    if (p.mood === 'low' || p.mood === 'ok' || p.mood === 'high') out.mood = p.mood
    return out
  } catch {
    return {}
  }
}

export function clearCheckin(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* nothing to clear */
  }
}

export function saveCheckin(memory: CheckinMemory): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(memory))
  } catch {
    /* it is only a convenience */
  }
}

/** "Alone" means nobody is free; "with someone" and "either" both mean someone is (the engine still honours their preference). */
export const socialAvailable = (company: Company): boolean => company !== 'alone'

/** Below this many minutes we do not ask anything beyond time and energy. */
export const QUICK_MINUTES = 5

export interface AskPlan {
  /** Show the company and outcome questions in full. */
  expanded: boolean
  /** With almost no time, do not ask at all (use what we remember, or nothing). */
  skipExtras: boolean
}

/**
 * Do we ask the extra questions in full, collapse them to a one-line summary, or skip them?
 *  - almost no time: skip (the person wants to go, not to answer questions);
 *  - nothing remembered: ask, in full;
 *  - remembered: a one-line summary they can change.
 */
export function askPlan(minutes: number, memory: CheckinMemory, userExpanded: boolean): AskPlan {
  if (minutes <= QUICK_MINUTES && !userExpanded) return { expanded: false, skipExtras: true }
  const knowsBoth = memory.company !== undefined && memory.outcome !== undefined
  return { expanded: userExpanded || !knowsBoth, skipExtras: false }
}
