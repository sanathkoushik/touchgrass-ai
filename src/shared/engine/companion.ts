import type { Activity, Companion, Context, MissionStep, DesiredOutcome } from './types'

/**
 * The Mission Companion's words. Everything here is built only from the person's own check-in (time, energy, what they
 * want out of it) and the activity's own data, so it is true by construction, works offline, and never claims to
 * know how the person feels beyond what they told us.
 */

export type PromptKind = 'walk' | 'explore' | 'social' | 'calm' | 'active' | 'play' | 'creative' | 'skill'

const KIND_BY_ACTIVITY: Record<string, PromptKind> = {
  brisk_walk_loop: 'walk',
  easy_jog: 'active',
  stair_climb: 'active',
  cycling_ride: 'active',
  badminton_game: 'play',
  football_kickabout: 'play',
  swim_session: 'active',
  stretch_flow: 'calm',
  bodyweight_park_circuit: 'active',
  living_room_dance: 'active',
  doorstep_reset: 'calm',
  new_street_walk: 'explore',
  sunset_spot_hunt: 'explore',
  photo_walk_challenge: 'explore',
  park_sit_and_watch: 'calm',
  local_market_wander: 'explore',
  new_cafe_walk: 'explore',
  nature_trail_hike: 'explore',
  waterfront_walk: 'explore',
  neighbourhood_scavenger_hunt: 'explore',
  rooftop_stargazing: 'calm',
  barefoot_grass_break: 'calm',
  quiet_reset: 'calm',
  call_friend_walk: 'social',
  walk_and_talk: 'social',
  outdoor_sketching: 'creative',
  ball_skills_practice: 'skill',
  basketball_shootaround: 'play',
  picnic_with_friend: 'social',
  litter_pick_walk: 'explore',
  cards_outside: 'social',
}

export function promptKind(activityId: string): PromptKind {
  return KIND_BY_ACTIVITY[activityId] ?? 'walk'
}

/**
 * One optional prompt to take part with while out (never a checklist). Three per kind, so repeats feel fresh.
 * The first of each kind is the document's own example.
 */
export const PROMPTS: Record<PromptKind, readonly [string, string, string]> = {
  walk: [
    "Notice one thing along your route that you haven't paid attention to before.",
    'Pick a landmark ahead and walk to it without checking your phone.',
    'Notice how your breathing settles after the first five minutes.',
  ],
  explore: [
    'Find an interesting detail in your surroundings.',
    'Find something small and interesting that most people walk past.',
    'Find a view you could not see from where you started.',
  ],
  social: [
    "Ask someone a question you wouldn't normally ask, if that feels comfortable.",
    'Say out loud one thing you are enjoying right now.',
    "Learn one thing about the person you're with that you didn't know.",
  ],
  calm: [
    'Notice three things you can see or hear.',
    "Notice one sound, one detail you hadn't noticed before, and one thing you find pleasant.",
    'Let your shoulders drop, and notice what changes.',
  ],
  active: [
    'Notice which part of your body feels best right now.',
    'Find a rhythm you could keep for another minute, then another.',
    'Notice the moment it starts to feel easier.',
  ],
  play: [
    'Notice one moment you enjoy, win or lose.',
    "Try one thing you haven't tried here before.",
    'Cheer for one good moment, yours or someone else\'s.',
  ],
  creative: [
    'Draw or write down one detail you would usually walk past.',
    'Look at something for a full minute before you draw any of it.',
    'Pick one colour you can see and find it three more times.',
  ],
  skill: [
    'Do one move a little better than your first try.',
    'Pick one small thing to improve and repeat it five times.',
    'Notice what feels smoother than when you started.',
  ],
}

/** What to do in the middle of the mission, in a sentence. */
const MAIN_DETAIL: Record<PromptKind, string> = {
  walk: 'Walk at an easy pace. There is nothing to prove.',
  explore: 'Wander without a destination and follow whatever catches your eye.',
  social: 'Be with the person or the moment. The phone can stay in your pocket.',
  calm: "Walk slowly or sit comfortably. Notice one sound, one detail you hadn't noticed before, and one thing you find pleasant. Do not force a particular feeling.",
  active: 'Keep it at a pace where you could still talk. Ease off whenever you want.',
  play: 'Play it light. Enjoying it matters more than the score.',
  creative: 'Make something small and imperfect. It only has to be yours.',
  skill: 'Practise slowly and notice what changes. A few good repetitions is plenty.',
}

/** A way to begin that asks almost nothing. */
const TINY_START: Record<PromptKind, string> = {
  walk: 'Put on your shoes and step out the door. Two minutes outside is the whole job for now.',
  explore: 'Step outside and look around for two minutes. You are allowed to stop there.',
  social: 'Send one message to start it, or just step out for two minutes. Either counts.',
  calm: 'Sit or stand somewhere comfortable with a window or door open for two minutes. That is the whole job.',
  active: 'Put on your shoes and move at an easy pace for just two minutes. Stopping then is allowed.',
  play: 'Pick up what you need and take it outside for two minutes. That is enough to start.',
  creative: 'Take your sketchbook or phone to a window or doorstep and look for two minutes.',
  skill: 'Do just two minutes of the easiest version. You can stop after that.',
}

/** For when going out is not possible, or too much today. Rest is allowed. */
const ALTERNATIVE: Record<PromptKind, string> = {
  walk: 'Not able to get out today? Sit or stand by an open window, or on a balcony, for the same time. Breathe slowly and look at the furthest thing you can see.',
  explore: 'Not able to get out today? Look out of a window or from a balcony and find three details you have never noticed.',
  social: 'If meeting up is not possible today, a short call or message to someone you like is a smaller version, and it counts.',
  calm: 'No safe outdoor space nearby, or too tired to go out? A comfortable seat by an open window, or a balcony, does the same job. Resting is allowed.',
  active: 'If going out is too much today, do a gentle version at home: slow stretches or an easy march on the spot.',
  play: 'If it is not possible to play today, a few minutes of easy movement at home is a smaller version.',
  creative: 'From a window or balcony you can still draw or write down what you see.',
  skill: 'At home, do a slow version of the same move for a few minutes.',
}

/** The document's wording for the three phases of a calm mission. */
const CALM_TITLES = ['Leave the noise behind', 'Let the mind wander', 'Return gently'] as const
const PLAIN_TITLES = ['Get going', 'The main part', 'Return gently'] as const

const OUTCOME_CLAUSE: Record<DesiredOutcome, string> = {
  clear_head: 'You want to clear your head.',
  energise: 'You want to feel more energetic.',
  break_routine: 'You want to break the routine.',
  connect: 'You want to feel connected.',
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** The minutes of each phase: about a fifth, a half-plus, and a quarter. Always adds up to `planned` exactly. */
export function splitMinutes(planned: number): number[] {
  const p = Math.max(1, Math.round(planned))
  if (p < 3) return [p]
  const first = Math.max(1, Math.round(p * 0.2))
  const last = Math.max(1, Math.round(p * 0.25))
  return [first, p - first - last, last]
}

export function buildSteps(activity: Activity, planned: number): MissionStep[] {
  const kind = promptKind(activity.id)
  const titles = kind === 'calm' ? CALM_TITLES : PLAIN_TITLES
  const minutes = splitMinutes(planned)
  const details = [
    activity.id === 'quiet_reset' ? 'Find a safe, nearby outdoor spot or another comfortable place with fresh air.' : activity.firstStep,
    MAIN_DETAIL[kind],
    'Head back or settle in. Notice whether anything feels different.',
  ]
  if (minutes.length === 1) return [{ minutes: minutes[0]!, title: titles[0], detail: `${details[0]} ${details[2]}` }]
  return minutes.map((m, i) => ({ minutes: m, title: titles[i]!, detail: details[i]! }))
}

const ADVERSE_WEATHER = new Set(['rain', 'storm', 'snow', 'fog'])

/** The window-or-balcony version, only when it is genuinely useful: going out is hard today, or the activity needs the outdoors. */
export function alternativeFor(activity: Activity, ctx: Pick<Context, 'mood' | 'mode' | 'weather' | 'hour' | 'is_daylight'>): string | null {
  const needsOutdoors = activity.weather !== 'any' || activity.travel !== 'none'
  if (!needsOutdoors) return null
  const hard = ctx.mood === 'low' || ctx.mode === 'minimum' || (ctx.weather ? ADVERSE_WEATHER.has(ctx.weather.category) : false)
  return hard ? ALTERNATIVE[promptKind(activity.id)] : null
}

/**
 * The note before starting. Reflects only what the person said: how much time, their energy, what they want out of it,
 * and the size of the day. It never claims to know how they feel beyond that.
 */
export function companionNote(ctx: Pick<Context, 'duration_limit' | 'mood' | 'mode' | 'desired_outcome'>): string {
  const time = plural(ctx.duration_limit, 'minute', 'minutes')
  const energy = ctx.mood === 'low' ? ' and your energy is low' : ctx.mood === 'high' ? ' and you have energy to spare' : ''
  const outcome = ctx.desired_outcome ? ` ${OUTCOME_CLAUSE[ctx.desired_outcome]}` : ''
  const mode = ctx.mode ?? 'normal'
  const tone =
    mode === 'minimum'
      ? "Let's keep it easy today. Give yourself permission to take it slowly. Your only commitment for now is the first two minutes."
      : mode === 'excellent'
        ? "Let's make the most of it. Start gently and build up."
        : "Here is something that fits. Start with the first step, and you can change the plan at any point."
  return `You have ${time}${energy}.${outcome} ${tone}`
}

export function buildCompanion(activity: Activity, ctx: Context, planned: number): Companion {
  const kind = promptKind(activity.id)
  return {
    note: companionNote(ctx),
    steps: buildSteps(activity, planned),
    tiny_start: { minutes: 2, text: TINY_START[kind] },
    alternative: alternativeFor(activity, ctx),
  }
}
