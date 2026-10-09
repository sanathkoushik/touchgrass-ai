/**
 * Shared engine types. Pure TypeScript, no browser or Worker APIs, so the same code
 * runs in the React app, the Cloudflare Worker and the test runner.
 */

export type Family = 'movement' | 'exploration' | 'social_skill'

// The runtime arrays below are the single source of truth: the types are derived from them,
// and the API validation (zod) reuses them, so the two can never drift apart.

/** Who an activity can be done with. An activity may support several modes. */
export const SOCIAL_MODES = ['solo', 'with_friend', 'small_group'] as const
export type SocialMode = (typeof SOCIAL_MODES)[number]

export const SOCIAL_PREFERENCES = [...SOCIAL_MODES, 'any'] as const
export type SocialPreference = (typeof SOCIAL_PREFERENCES)[number]

/** Gear an activity needs. Phone, shoes and clothes are assumed; only list real extras. */
export const EQUIPMENT = [
  'bicycle',
  'racket',
  'ball',
  'swimwear',
  'yoga_mat',
  'sketchbook',
  'cards',
  'trash_bag',
] as const
export type Equipment = (typeof EQUIPMENT)[number]

export const MOTIVATORS = [
  'novelty',
  'social',
  'exploration',
  'mastery',
  'competition',
  'calm',
  'creativity',
  'nature',
  'purpose',
  'music',
  'food',
] as const
export type Motivator = (typeof MOTIVATORS)[number]

/** Existing enjoyable things that can ride along (temptation bundling). */
export type Bundle = 'music' | 'podcast' | 'audiobook' | 'call' | 'photo'

export type Cost = 'free' | 'low' | 'medium'
export type Travel = 'none' | 'short' | 'far'

/**
 * What weather an activity tolerates.
 *  any       - fine in any weather (indoors / sheltered)
 *  dry       - no rain, storm or snow
 *  fair      - dry AND a comfortable temperature
 *  clear_sky - needs a clear sky (stargazing)
 */
export type WeatherTolerance = 'any' | 'dry' | 'fair' | 'clear_sky'

export type Daylight = 'day' | 'night' | 'any'

export type Intensity = 1 | 2 | 3

export interface Activity {
  id: string
  title: string
  family: Family
  /** Minutes: the shortest and longest sensible version, plus the default we suggest. */
  duration: { min: number; max: number; default: number }
  social: SocialMode[]
  /** True when the activity cannot be done alone (needs a partner or group). */
  needsOthers: boolean
  intensity: Intensity
  /** How fresh it feels for most people: 1 routine, 3 adventurous. */
  novelty: Intensity
  cost: Cost
  travel: Travel
  /** Gear that must be owned to do the activity. */
  equipment: Equipment[]
  weather: WeatherTolerance
  daylight: Daylight
  /** Free-form tags used to match likes/dislikes (e.g. "running", "photography"). */
  tags: string[]
  motivators: Motivator[]
  bundles: Bundle[]
  /** One tiny, concrete action that starts the activity within a minute. */
  firstStep: string
}

// ---------------------------------------------------------------- user data

export interface Preferences {
  likes: string[]
  dislikes: string[]
  preferred_duration_min: number
  social_preference: SocialPreference
}

export const AVOIDANCES = ['too_far', 'high_cost'] as const
export type Avoidance = (typeof AVOIDANCES)[number]

export interface UserProfile {
  user_id: string
  preferences: Preferences
  motivators: Motivator[]
  avoidances: Avoidance[]
  /** Gear the user actually owns. */
  equipment: Equipment[]
}

export const OUTCOMES = ['completed', 'partial', 'skipped', 'changed'] as const
export type Outcome = (typeof OUTCOMES)[number]

export const SKIP_REASONS = [
  'too_tired',
  'too_far',
  'no_time',
  'bad_weather',
  'no_friend',
  'too_costly',
  'boring',
  'other',
] as const
export type SkipReason = (typeof SKIP_REASONS)[number]

/** One past recommendation and what happened with it. */
export interface HistoryEvent {
  activity_id: string
  /** ISO 8601. */
  timestamp: string
  outcome: Outcome
  /** 1-5, only meaningful for completed/partial. */
  enjoyment?: number
  skip_reason?: SkipReason
}

// ------------------------------------------------------------------ context

export type WeatherCategory = 'clear' | 'cloudy' | 'fog' | 'rain' | 'storm' | 'snow'

export interface Weather {
  category: WeatherCategory
  temp_c: number
}

export const MOODS = ['low', 'ok', 'high'] as const
export type Mood = (typeof MOODS)[number]

export interface Context {
  /** Minutes the user has. */
  duration_limit: number
  /** Is someone free to join right now? */
  social_available: boolean
  mood: Mood
  /** Local hour 0-23. */
  hour: number
  /** Real daylight if known (e.g. from sunrise/sunset); otherwise derived from the hour. */
  is_daylight?: boolean
  /** Undefined when weather is unavailable: the engine then does not filter on it. */
  weather?: Weather
}

// ------------------------------------------------------------------ outputs

export interface Rejection {
  activity_id: string
  reasons: string[]
}

export interface FilterResult {
  candidates: Activity[]
  rejected: Rejection[]
}

export type ScoreComponent =
  | 'preference'
  | 'enjoyment'
  | 'novelty'
  | 'social_fit'
  | 'time_fit'
  | 'duration_fit'
  | 'friction'
  | 'mood_fit'

export interface ScoredActivity {
  activity: Activity
  score: number
  components: Record<ScoreComponent, number>
  /** Facts that back the explanation, derived from real data (never invented). */
  evidence: {
    observed_n: number
    observed_done: number
    declared_like: string | null
    recently_suggested: boolean
    /** How many past events existed when scoring. Zero means "no history", so no claims about it. */
    history_size: number
  }
}

/** Matches the API response shape in the project report (section 18.4). */
export interface Recommendation {
  activity_id: string
  title: string
  duration_min: number
  reason: string
  first_step: string
  social_mode: SocialMode
  /** A second, safer option when there is one. */
  fallback: { activity_id: string; title: string; first_step: string } | null
  /** Where this came from, so the UI and logs can tell the difference. */
  source: 'deterministic' | 'ai'
  /** The model that wrote the wording, when source is 'ai'. */
  model?: string
}
