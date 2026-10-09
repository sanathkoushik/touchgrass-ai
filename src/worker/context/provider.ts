import type { WeatherCategory } from '@/shared/engine/types'

/** Live conditions at a place, as reported by the weather service. */
export interface Conditions {
  category: WeatherCategory
  temp_c: number
  /** True when the sun is up at that place right now. */
  is_day: boolean
  /** Local clock times at the place, "HH:MM". */
  sunrise?: string
  sunset?: string
  /** The place's offset from UTC, so we know ITS local time of day (not the server's). */
  utc_offset_seconds: number
}

export interface Place {
  name: string
  region?: string
  country?: string
  lat: number
  lon: number
}

/**
 * Where real-time context comes from. Implementations must never throw for expected problems
 * (service down, timeout, nothing found): they return null, and the app plans without that context.
 */
export interface ContextProvider {
  conditions(lat: number, lon: number): Promise<Conditions | null>
  places(query: string): Promise<Place[] | null>
}
