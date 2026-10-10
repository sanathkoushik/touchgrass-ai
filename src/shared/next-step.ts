import type { ActivityMode, DesiredOutcome, Feeling, Helper, Mood, Outcome, SkipReason, WouldRepeat } from './engine/types'

/**
 * What happens next after an answer. Two jobs, both from the document:
 *  1. When a mission did not happen, always offer a SMALLER next step (never blame, never a dead end).
 *  2. When the person tells us how it went, say plainly what we will do differently, so that answering visibly matters.
 *
 * Everything we promise here is something the engine really does (see score.ts: outcome_fit, learned, friction, modes),
 * and promises about patterns are conditional ("if this keeps happening"), because one answer never defines anyone.
 */

/** A ready-made set of check-in answers for "Try this": opens Plan with these already chosen. */
export interface PlanPrefill {
  duration_limit: number
  mood?: Mood
  mode?: 'auto' | ActivityMode
  social_available?: boolean
  desired_outcome?: DesiredOutcome | null
}

export interface NextStep {
  headline: string
  detail: string
  /** The button: what it says and what it chooses. Omitted when there is nothing smaller to offer. */
  action?: { label: string; plan: PlanPrefill }
}

/** The smaller next step after a mission that did not happen (or happened differently). */
export function nextStepFor(outcome: Outcome, reason?: SkipReason | null): NextStep | null {
  if (outcome !== 'skipped' && outcome !== 'changed') return null
  if (outcome === 'changed') {
    return {
      headline: 'Good to know what you did instead.',
      detail: 'That tells us what you felt like today. Want to see something else when you are ready?',
    }
  }
  switch (reason) {
    case 'couldnt_start':
      return {
        headline: 'Starting is often the hardest part.',
        detail: 'Let us shrink it: two minutes, at the door or by a window. If that is all you do, it still counts.',
        action: { label: 'Try a two-minute start', plan: { duration_limit: 5, mode: 'minimum', mood: 'low' } },
      }
    case 'too_tired':
      return {
        headline: 'Your body asked for less today. That is a good thing to listen to.',
        detail: 'Here is something gentle and restful, and it can be done sitting down.',
        action: { label: 'Find a restful one', plan: { duration_limit: 15, mode: 'minimum', mood: 'low', desired_outcome: 'clear_head' } },
      }
    case 'no_time':
      return {
        headline: 'Short on time? Five minutes is real.',
        detail: 'A tiny version, because small things done are better than big things planned.',
        action: { label: 'Try five minutes', plan: { duration_limit: 5, mode: 'minimum' } },
      }
    case 'bad_weather':
      return {
        headline: 'The weather did not help.',
        detail: 'Here is something small that does not depend on it.',
        action: { label: 'Find a weather-proof one', plan: { duration_limit: 15, mode: 'minimum' } },
      }
    case 'no_friend':
      return {
        headline: 'No one to join? That is fine.',
        detail: 'Here is something that works just as well on your own.',
        action: { label: 'Find one for just me', plan: { duration_limit: 20, social_available: false } },
      }
    case 'boring':
      return {
        headline: 'Not exciting? Then let us try something different.',
        detail: 'We will lean toward things you have not done much.',
        action: { label: 'Show me something different', plan: { duration_limit: 30, desired_outcome: 'break_routine' } },
      }
    case 'too_far':
      return {
        headline: 'Too far today.',
        detail: 'Here is something right on your doorstep.',
        action: { label: 'Find something close', plan: { duration_limit: 15, mode: 'minimum' } },
      }
    case 'too_costly':
      return {
        headline: 'Cost got in the way.',
        detail: 'Most of what we suggest is free. Here is a smaller one.',
        action: { label: 'Find a free one', plan: { duration_limit: 15, mode: 'minimum' } },
      }
    default:
      return {
        headline: 'That is okay. Not every day goes to plan.',
        detail: 'When you are ready, a smaller one is always available.',
        action: { label: 'Try a smaller one', plan: { duration_limit: 10, mode: 'minimum' } },
      }
  }
}

export interface AnswerSignals {
  feeling?: Feeling | null
  helper?: Helper | null
  barrier?: SkipReason | null
  would_repeat?: WouldRepeat | null
}

/**
 * Sentences saying what we will do differently because of the answers just given. Short, kind, and honest about the
 * fact that one answer is only a hint.
 */
export function adaptationMessages(a: AnswerSignals): string[] {
  const out: string[] = []
  switch (a.feeling) {
    case 'calmer':
      out.push('Noted that it left you calmer. If that keeps happening, we will suggest more gentle resets when they fit.')
      break
    case 'more_energetic':
      out.push('Noted that it left you more energetic. If that keeps happening, we will lean toward active missions when you want a boost.')
      break
    case 'happier':
      out.push('Glad it lifted your mood. We will remember this one as a good fit.')
      break
    case 'same':
      out.push('Feeling the same is useful to know, not a failure. We will offer something different next time instead of repeating this.')
      break
    case 'more_tired':
      out.push('Thanks for telling us it left you more tired. We will lean toward gentler missions for now.')
      break
  }
  if (a.helper === 'noticing_things') out.push('You enjoyed noticing things. If that keeps helping, we will offer more discovery-based missions.')
  if (a.helper === 'company') out.push('Company helped. We will keep suggesting things to do with someone when you have someone free.')
  if (a.helper === 'kept_short') out.push('Keeping it short helped. We will keep short options coming.')
  if (a.barrier === 'couldnt_start') out.push('Getting started was the hard part. We will offer a two-minute start more readily.')
  if (a.barrier === 'too_tired') out.push('Low energy made it harder. We will lean toward easier, seated options.')
  if (a.would_repeat === 'no') out.push('We will suggest this one less often.')
  if (a.would_repeat === 'yes') out.push('We will keep this one in the mix.')
  return out
}
