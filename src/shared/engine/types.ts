/**
 * Shared engine types. Pure TypeScript, no browser or Worker APIs, so the same code
 * runs in the React app, the Cloudflare Worker and the test runner.
 */

export type Family = 'movement' | 'exploration' | 'social_skill'

/** Who an activity can be done with. An activity may support several modes. */
export type SocialMode = 'solo' | 'with_friend' | 'small_group'

export type SocialPreference = SocialMode | 'any'

/** Gear an activity needs. Phone, shoes and clothes are assumed; only list real extras. */
export type Equipment =
  | 'bicycle'
  | 'racket'
  | 'ball'
  | 'swimwear'
  | 'yoga_mat'
  | 'sketchbook'
  | 'cards'
  | 'trash_bag'

export type Motivator =
  | 'novelty'
  | 'social'
  | 'exploration'
  | 'mastery'
  | 'competition'
  | 'calm'
  | 'creativity'
  | 'nature'
  | 'purpose'
  | 'music'
  | 'food'

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

export type Avoidance = 'too_far' | 'high_cost'

export interface UserProfile {
  user_id: string
  preferences: Preferences
  motivators: Motivator[]
  avoidances: Avoidance[]
  /** Gear the user actually owns. */
  equipment: Equipment[]
}

export type Outcome = 'completed' | 'partial' | 'skipped' | 'changed'

export type SkipReason =
  | 'too_tired'
  | 'too_far'
  | 'no_time'
  | 'bad_weather'
  | 'no_friend'
  | 'too_costly'
  | 'boring'
  | 'other'

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

export type Mood = 'low' | 'ok' | 'high'

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
  source: 'deterministic'
}
