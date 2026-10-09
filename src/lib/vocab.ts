import type { Avoidance, Equipment, Mood, Motivator, SkipReason, SocialPreference, WeatherCategory } from '@/shared/engine/types'

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
  other: 'Something else',
}

export const DURATION_OPTIONS_FOR_PLAN = [15, 30, 45, 60, 90, 120] as const

/** Plain words for the live sky, as shown in the app (from Open-Meteo's weather code). */
export const WEATHER_LABELS: Record<WeatherCategory, string> = {
  clear: 'Clear',
  cloudy: 'Cloudy',
  fog: 'Foggy',
  rain: 'Rainy',
  storm: 'Stormy',
  snow: 'Snowy',
}
