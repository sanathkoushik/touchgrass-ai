import { z } from 'zod'
import type { WeatherCategory } from './engine/types'
import { roundCoord, roundLocation, type Location } from './geo'

// Re-exported so server code keeps one import. The browser must import from './geo' (no zod).
export { roundCoord, roundLocation, type Location }

/**
 * Location and live conditions: shared by the Worker (validation) and the React app (types).
 *
 * Privacy rules this file encodes:
 *  - coordinates are rounded to 2 decimals (about 1 km) before they go anywhere;
 *  - the server never stores them: only the weather CATEGORY and temperature are kept with a recommendation.
 */

export const locationSchema = z.strictObject({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
})
// (Location and roundLocation live in ./geo; the schema above accepts exactly that shape.)

export const contextInputSchema = z.strictObject({ location: locationSchema })
export const placesInputSchema = z.strictObject({ q: z.string().trim().min(2).max(60) })

export interface WeatherSummary {
  category: WeatherCategory
  temp_c: number
}

/** What it is like outside, as shown to the person. All values come from Open-Meteo at request time. */
export interface ConditionsSummary {
  weather: WeatherSummary
  daylight: 'day' | 'night'
  /** Local clock times at the place, "HH:MM". Present on /api/context only. */
  sunrise?: string
  sunset?: string
}

export interface ContextResponse {
  /** False when the weather service could not be reached; the app then just plans without weather. */
  available: boolean
  conditions?: ConditionsSummary
}

export interface PlaceResult {
  name: string
  region?: string
  country?: string
  lat: number
  lon: number
}

export interface PlacesResponse {
  available: boolean
  places: PlaceResult[]
}
