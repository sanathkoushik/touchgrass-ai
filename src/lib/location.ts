import { roundLocation, type Location } from '@/shared/context'

const KEY = 'tg_place'

/**
 * The place the person chose to share, kept ONLY in this browser (never saved on our servers).
 * Coordinates are already rounded to ~1 km.
 */
export interface SavedPlace extends Location {
  /** What to show: "Near you" for the device location, or the city name for a searched place. */
  label: string
  source: 'device' | 'search'
}

export function loadPlace(): SavedPlace | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<SavedPlace>
    if (typeof p.lat !== 'number' || typeof p.lon !== 'number' || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) return null
    if (typeof p.label !== 'string' || p.label.length === 0 || p.label.length > 120) return null
    if (p.source !== 'device' && p.source !== 'search') return null
    return { ...roundLocation({ lat: p.lat, lon: p.lon }), label: p.label, source: p.source }
  } catch {
    return null
  }
}

export function savePlace(place: SavedPlace): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...roundLocation(place), label: place.label, source: place.source }))
  } catch {
    /* storage unavailable: the place still works for this visit */
  }
}

export function clearPlace(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* nothing to clear */
  }
}

export type LocationErrorCode = 'denied' | 'unavailable' | 'timeout' | 'unsupported'

const MESSAGES: Record<LocationErrorCode, string> = {
  denied: 'Location was blocked. You can allow it in your browser settings, or search for a city instead.',
  unavailable: 'Your device could not work out where you are. Try searching for a city instead.',
  timeout: 'Finding your location took too long. Try again, or search for a city instead.',
  unsupported: 'This browser cannot share a location. Search for a city instead.',
}

export class LocationError extends Error {
  readonly code: LocationErrorCode

  constructor(code: LocationErrorCode) {
    super(MESSAGES[code])
    this.name = 'LocationError'
    this.code = code
  }
}

/**
 * Asks the browser for the device location. Call this ONLY from a tap: the browser shows its own permission
 * prompt, and the person must stay in control. The result is rounded to ~1 km straight away.
 */
export function requestDeviceLocation(): Promise<Location> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new LocationError('unsupported'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(roundLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude })),
      (err) => reject(new LocationError(err.code === 1 ? 'denied' : err.code === 3 ? 'timeout' : 'unavailable')),
      // Coarse is enough for weather, and faster and more private than high accuracy.
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 10 * 60_000 },
    )
  })
}
