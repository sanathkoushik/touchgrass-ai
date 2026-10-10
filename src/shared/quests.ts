import { PROMPTS, promptKind } from './engine/companion'

/**
 * The prompt for while the person is out: ONE optional, activity-specific thing to notice or try, never a checklist.
 * (Walking gets a walking prompt, exploring an exploring one, a social activity a social one, calm ones a calm one.)
 * Nothing here needs money, a stranger, or anything risky, and all of it can be done with the phone in a pocket.
 *
 * Which of an activity's three prompts a mission gets is a pure function of its id, so the same mission always shows
 * the same prompt (after a reload, or offline) and nothing needs to be stored.
 */

/** FNV-1a: tiny, stable, no dependencies. */
function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

export const QUESTS_PER_MISSION = 1

/** The one prompt for this mission (returned as a list so the screens can treat it uniformly). */
export function questsFor(activityId: string, missionId: string): string[] {
  const bank = PROMPTS[promptKind(activityId)]
  return [bank[hash(`${missionId}|${activityId}`) % bank.length]!]
}

export const ALL_QUESTS: readonly string[] = Object.values(PROMPTS).flat()
