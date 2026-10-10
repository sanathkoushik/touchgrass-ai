import type { Company } from './checkin'
import type { ActivityMode, Avoidance, DesiredOutcome, Equipment, Feeling, Goal, Helper, Mood, ParticipationStatus, WouldRepeat, Motivator, SkipReason, SocialPreference, WeatherCategory } from '@/shared/engine/types'

/**
 * Human wording for every choice the person can make. These are `Record<Union, ...>` on purpose:
 * if the engine ever gains a new motivator, equipment item or skip reason, this file stops compiling
 * until it has a label, so the UI can never show a raw code.
 */

/** Interests. `term` is matched against the activity catalog's tags, so each one really changes recommendations. */
export const INTERESTS: readonly { label: string; term: string }[] = [
  { label: 'Walking', term: 'walking' },
  { label: 'Running', term: 'running' },
  { label: 'Cycling', term: 'cycling' },
  { label: 'Swimming', term: 'swimming' },
  { label: 'Hiking', term: 'hiking' },
  { label: 'Yoga & stretching', term: 'yoga' },
  { label: 'Dancing', term: 'dance' },
  { label: 'Strength', term: 'strength' },
  { label: 'Badminton', term: 'badminton' },
  { label: 'Football', term: 'football' },
  { label: 'Basketball', term: 'basketball' },
  { label: 'Photography', term: 'photography' },
  { label: 'Drawing', term: 'drawing' },
  { label: 'Nature', term: 'nature' },
  { label: 'Exploring', term: 'exploring' },
  { label: 'Cafés & tea stalls', term: 'cafe' },
  { label: 'Markets', term: 'market' },
  { label: 'Stargazing', term: 'stargazing' },
  { label: 'Picnics', term: 'picnic' },
  { label: 'Card & board games', term: 'games' },
  { label: 'Volunteering', term: 'volunteering' },
  { label: 'Quiet moments', term: 'mindfulness' },
]

export const MOTIVATOR_LABELS: Record<Motivator, { label: string; hint: string }> = {
  novelty: { label: 'Something new', hint: 'Fresh places and ideas' },
  social: { label: 'Company', hint: 'Doing it with people' },
  exploration: { label: 'Exploring', hint: 'Finding places and views' },
  mastery: { label: 'Getting better', hint: 'Practising a skill' },
  competition: { label: 'A little competition', hint: 'Games and challenges' },
  calm: { label: 'Calm', hint: 'Slowing down' },
  creativity: { label: 'Creating', hint: 'Making or capturing something' },
  nature: { label: 'Nature', hint: 'Green and open spaces' },
  purpose: { label: 'Purpose', hint: 'Doing some good' },
  music: { label: 'Music', hint: 'A soundtrack to move to' },
  food: { label: 'Good food', hint: 'A treat along the way' },
}

export const EQUIPMENT_LABELS: Record<Equipment, string> = {
  bicycle: 'A bicycle',
  racket: 'A badminton racket',
  ball: 'A ball',
  swimwear: 'Swimwear',
  yoga_mat: 'A yoga mat',
  sketchbook: 'A sketchbook',
  cards: 'Cards or a board game',
  trash_bag: 'Bags for a clean-up',
}

export const AVOIDANCE_LABELS: Record<Avoidance, string> = {
  too_far: 'Anything far away',
  high_cost: 'Anything that costs money',
}

export const SOCIAL_LABELS: Record<SocialPreference, string> = {
  solo: 'On my own',
  with_friend: 'With a friend',
  small_group: 'In a small group',
  any: 'No preference',
}

export const DURATION_CHOICES = [20, 30, 45, 60, 90] as const

/** Typical free time. Stored as HH:MM-HH:MM windows, which the engine will use for timing later. */
export const WINDOW_CHOICES: readonly { label: string; window: string }[] = [
  { label: 'Mornings', window: '06:00-10:00' },
  { label: 'Afternoons', window: '12:00-16:00' },
  { label: 'Evenings', window: '17:00-21:00' },
]

export const MOOD_LABELS: Record<Mood, { label: string; hint: string }> = {
  low: { label: 'Low', hint: 'Keep it gentle' },
  ok: { label: 'Okay', hint: 'Anything reasonable' },
  high: { label: 'Energised', hint: 'Bring it on' },
}

export const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  too_tired: 'Too tired',
  too_far: 'Too far',
  no_time: 'No time',
  bad_weather: 'Bad weather',
  no_friend: 'No one to join',
  too_costly: 'Costs too much',
  boring: 'Not exciting',
  couldnt_start: 'I could not get started',
  other: 'Something else',
}

export const DURATION_OPTIONS_FOR_PLAN = [5, 15, 30, 45, 60, 90, 120] as const

/** Plain words for the live sky, as shown in the app (from Open-Meteo's weather code). */
export const WEATHER_LABELS: Record<WeatherCategory, string> = {
  clear: 'Clear',
  cloudy: 'Cloudy',
  fog: 'Foggy',
  rain: 'Rainy',
  storm: 'Stormy',
  snow: 'Snowy',
}

export const GOAL_LABELS: Record<Goal, string> = {
  move_more: 'Move more',
  be_outdoors: 'Be outdoors more',
  feel_calmer: 'Feel calmer',
  meet_people: 'Meet people',
  try_new_things: 'Try new things',
  be_creative: 'Be creative',
}

/** The size of the day, in guilt-free words. 'auto' = let the app adapt to how things have been going. */
export const MODE_CHOICES: readonly { value: 'auto' | ActivityMode; label: string; hint: string }[] = [
  { value: 'auto', label: 'Adapt to me', hint: 'Based on how things are going' },
  { value: 'minimum', label: 'Tiny start', hint: 'The smallest real version' },
  { value: 'normal', label: 'Normal', hint: 'The usual' },
  { value: 'excellent', label: 'Stretch', hint: 'Go a bit bigger' },
]

export const MODE_PILL: Record<ActivityMode, string | null> = {
  minimum: 'Small start',
  normal: null,
  excellent: 'Stretch',
}

/** What the person wants out of this mission (the check-in). */
export const DESIRED_OUTCOME_LABELS: Record<DesiredOutcome, { label: string; hint: string }> = {
  clear_head: { label: 'Clear my head', hint: 'Calm and quiet' },
  energise: { label: 'Feel more energetic', hint: 'Get moving' },
  break_routine: { label: 'Break the routine', hint: 'Something different' },
  connect: { label: 'Feel connected', hint: 'With someone' },
}

export const COMPANY_LABELS: Record<Company, { label: string; hint: string }> = {
  alone: { label: 'On my own', hint: 'Nobody is free' },
  together: { label: 'With someone', hint: 'Someone can join' },
  either: { label: 'Either', hint: 'Whatever fits' },
}

/** How they feel afterwards compared with before. */
export const FEELING_LABELS: Record<Feeling, string> = {
  calmer: 'Calmer',
  more_energetic: 'More energetic',
  happier: 'Happier',
  same: 'About the same',
  more_tired: 'More tired',
}

export const HELPER_LABELS: Record<Helper, string> = {
  clear_plan: 'Having a plan',
  company: 'Company',
  music_or_podcast: 'Music or a podcast',
  good_weather: 'Good weather',
  kept_short: 'Keeping it short',
  noticing_things: 'Noticing things',
}

export const WOULD_REPEAT_LABELS: Record<WouldRepeat, string> = { yes: 'Yes, again', maybe: 'Maybe', no: 'Not really' }

export const PARTICIPATION_LABELS: Record<ParticipationStatus, string> = {
  full: 'Did it',
  partial: 'Part of it',
  not_started: 'Did not go',
  something_else: 'Did something else',
}
