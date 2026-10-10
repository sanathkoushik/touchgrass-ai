import { getActivity } from './engine/activities'
import type { Family } from './engine/types'

/**
 * Side quests: one small, playful thing to look for or do DURING a mission, so the person is taking part in it
 * instead of waiting for it to end (the report's scavenger and photo challenges). Nothing here needs money, a
 * stranger, or anything risky, and all of it can be done with the phone in a pocket.
 *
 * Which two a mission gets is a pure function of its id, so the same mission always shows the same two (even after a
 * reload or while offline) and nothing needs to be stored.
 */
const ANYWHERE = [
  'Notice three different sounds and where each one comes from.',
  'Find something that is moving and something that is perfectly still.',
  'Find the best shade of green you can see.',
  'Look up for ten seconds. What is up there that you usually miss?',
  'Spot something that has been here much longer than you have.',
  'Find one thing that smells good, or one that smells surprising.',
  'Keep the phone in your pocket for the first ten minutes.',
  'Find something small and interesting that most people walk past.',
]

const BY_FAMILY: Record<Family, string[]> = {
  movement: [
    'Notice how your breathing settles after the first five minutes.',
    'Pick a landmark ahead and reach it without checking your phone.',
    'Find the steepest or roughest bit of your route and take it slowly.',
    'Walk or move one stretch with your shoulders dropped and your jaw loose.',
    'Notice which part of your body feels best right now.',
  ],
  exploration: [
    'Find something yellow.',
    'Take one photo you would actually print.',
    'Find the oldest-looking thing on your route.',
    'Find a view you could not see from where you started.',
    'Spot three different kinds of tree, roof or flower.',
  ],
  social_skill: [
    'Learn one new thing about the person you are with, or about the thing you are practising.',
    'Do one move or moment a little better than your first try.',
    'Make someone smile, or make yourself smile once.',
    'Say out loud one thing you are enjoying right now.',
    'Try one version of this you have never tried before.',
  ],
}

/** FNV-1a: tiny, stable, no dependencies. */
function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

export const QUESTS_PER_MISSION = 2

/** Two different side quests for a mission: one in the activity's own style, one that works anywhere. */
export function questsFor(activityId: string, missionId: string): string[] {
  const family = getActivity(activityId)?.family ?? 'movement'
  const own = BY_FAMILY[family]
  const first = own[hash(`${missionId}|own`) % own.length]!
  const second = ANYWHERE[hash(`${missionId}|any`) % ANYWHERE.length]!
  return [first, second].slice(0, QUESTS_PER_MISSION)
}

export const ALL_QUESTS: readonly string[] = [...ANYWHERE, ...Object.values(BY_FAMILY).flat()]
