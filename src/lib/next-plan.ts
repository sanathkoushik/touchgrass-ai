import { DESIRED_OUTCOMES } from '@/shared/engine/types'
import type { PlanPrefill } from '@/shared/next-step'

/**
 * "Try this" hands a ready-made check-in from one screen to the Plan screen (a smaller next step after a mission that
 * did not happen, or something the assistant noticed). It is read ONCE and then forgotten, so a reload never repeats it.
 */
const KEY = 'tg_next_plan'

export function queueNextPlan(plan: PlanPrefill): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(plan))
  } catch {
    /* the person can still choose the same thing by hand */
  }
}

export function takeNextPlan(): PlanPrefill | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    sessionStorage.removeItem(KEY)
    const p = JSON.parse(raw) as Record<string, unknown>
    if (typeof p.duration_limit !== 'number' || !Number.isInteger(p.duration_limit) || p.duration_limit < 5 || p.duration_limit > 480) return null
    const out: PlanPrefill = { duration_limit: p.duration_limit }
    if (p.mood === 'low' || p.mood === 'ok' || p.mood === 'high') out.mood = p.mood
    if (p.mode === 'auto' || p.mode === 'minimum' || p.mode === 'normal' || p.mode === 'excellent') out.mode = p.mode
    if (typeof p.social_available === 'boolean') out.social_available = p.social_available
    if (p.desired_outcome === null) out.desired_outcome = null
    else if (DESIRED_OUTCOMES.includes(p.desired_outcome as (typeof DESIRED_OUTCOMES)[number])) out.desired_outcome = p.desired_outcome as (typeof DESIRED_OUTCOMES)[number]
    return out
  } catch {
    return null
  }
}
