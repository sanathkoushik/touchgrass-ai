import { z } from 'zod'
import { locationSchema } from './context'

/**
 * Real places near the person, from OpenStreetMap. Deliberately small: a few names and distances for the
 * activity being suggested, not a map. Only activities that really happen AT a kind of place are listed here.
 */

export interface PlaceKind {
  /** Heading shown to the person. */
  label: string
  /** Search radius in metres, sized to how far people reasonably go for it. */
  radius_m: number
  /** OpenStreetMap tag filters; ALL must match. Values are alternatives. These are constants, never user input. */
  tags: readonly (readonly [key: string, values: readonly string[]])[]
}

export const PLACE_KINDS = {
  park: { label: 'Parks and gardens', radius_m: 2500, tags: [['leisure', ['park', 'garden']]] },
  nature: { label: 'Nature spots', radius_m: 6000, tags: [['leisure', ['nature_reserve']]] },
  cafe: { label: 'Cafés', radius_m: 1500, tags: [['amenity', ['cafe']]] },
  market: { label: 'Markets', radius_m: 3000, tags: [['amenity', ['marketplace']]] },
  water: { label: 'Lakes and waterfronts', radius_m: 5000, tags: [['natural', ['water']]] },
  viewpoint: { label: 'Viewpoints', radius_m: 6000, tags: [['tourism', ['viewpoint']]] },
  football: { label: 'Football pitches', radius_m: 3500, tags: [['leisure', ['pitch']], ['sport', ['soccer', 'football']]] },
  basketball: { label: 'Basketball courts', radius_m: 3500, tags: [['leisure', ['pitch']], ['sport', ['basketball']]] },
  badminton: { label: 'Badminton courts', radius_m: 4000, tags: [['sport', ['badminton']]] },
  swimming: { label: 'Swimming pools', radius_m: 5000, tags: [['leisure', ['swimming_pool', 'sports_centre']], ['sport', ['swimming']]] },
} as const satisfies Record<string, PlaceKind>

export type PlaceKindId = keyof typeof PLACE_KINDS

/** Activities that happen at a kind of place. Everything else (home, any street, the rooftop) has none. */
const ACTIVITY_PLACE_KIND: Readonly<Record<string, PlaceKindId>> = {
  brisk_walk_loop: 'park',
  easy_jog: 'park',
  bodyweight_park_circuit: 'park',
  photo_walk_challenge: 'park',
  park_sit_and_watch: 'park',
  barefoot_grass_break: 'park',
  call_friend_walk: 'park',
  walk_and_talk: 'park',
  outdoor_sketching: 'park',
  ball_skills_practice: 'park',
  picnic_with_friend: 'park',
  litter_pick_walk: 'park',
  cards_outside: 'park',
  nature_trail_hike: 'nature',
  new_cafe_walk: 'cafe',
  local_market_wander: 'market',
  waterfront_walk: 'water',
  sunset_spot_hunt: 'viewpoint',
  football_kickabout: 'football',
  basketball_shootaround: 'basketball',
  badminton_game: 'badminton',
  swim_session: 'swimming',
}

export function placeKindFor(activityId: string): PlaceKindId | null {
  return ACTIVITY_PLACE_KIND[activityId] ?? null
}

// ------------------------------------------------------------------ API shapes

export const nearbyInputSchema = z.strictObject({
  location: locationSchema,
  activity_id: z.string().trim().min(1).max(60),
})

export interface NearbyPlace {
  name: string
  /** Straight-line distance from the (rounded) point the person shared, to the nearest 50 m. */
  distance_m: number
  /** OpenStreetMap object, e.g. "way/15802464", for a link to the real map entry. */
  osm: string
}

export interface NearbyResponse {
  /** False when the places service could not be reached; the mission simply shows no places. */
  available: boolean
  kind?: { id: PlaceKindId; label: string }
  places: NearbyPlace[]
}
