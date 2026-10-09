/**
 * The few location helpers the browser needs at runtime. Kept free of zod on purpose: importing the schema files
 * from the React app would ship the whole validation library to every visitor (measured: ~100 kB of JavaScript).
 */

/** 2 decimals is about 1.1 km: precise enough for weather, too coarse to find a house. */
export const roundCoord = (n: number): number => Math.round(n * 100) / 100

export interface Location {
  lat: number
  lon: number
}

export const roundLocation = (l: Location): Location => ({ lat: roundCoord(l.lat), lon: roundCoord(l.lon) })
