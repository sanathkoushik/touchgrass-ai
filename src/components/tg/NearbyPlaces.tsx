import { useEffect, useState } from 'react'
import { MapPin } from 'lucide-react'
import type { Location } from '@/shared/context'
import { placeKindFor, type NearbyResponse } from '@/shared/places'
import { getNearby } from '@/lib/api'

type Props = {
  activityId: string
  location: Location | null
}

const OSM_OBJECT = /^(node|way|relation)\/\d+$/

function distanceLabel(m: number): string {
  return m < 1000 ? `${Math.max(50, m)} m` : `${(m / 1000).toFixed(1)} km`
}

/**
 * A few real places (from OpenStreetMap) where this activity can happen, near the place the person shared.
 * Loaded in the background AFTER the mission is on screen, and silent when there is nothing to show:
 * the mission never depends on it.
 */
export function NearbyPlaces({ activityId, location }: Props) {
  const [result, setResult] = useState<NearbyResponse | null>(null)

  const lat = location?.lat
  const lon = location?.lon
  const hasKind = placeKindFor(activityId) !== null
  useEffect(() => {
    setResult(null)
    if (lat === undefined || lon === undefined || !hasKind) return
    const ac = new AbortController()
    getNearby({ lat, lon }, activityId, ac.signal)
      .then(setResult)
      .catch(() => {
        /* optional extra: stay silent */
      })
    return () => ac.abort()
  }, [activityId, lat, lon, hasKind])

  if (!result || !result.available || result.places.length === 0 || !result.kind) return null

  return (
    <section aria-label="Places nearby" className="rounded-2xl border bg-card/60 p-4">
      <p className="flex items-center gap-2 text-sm font-medium">
        <MapPin className="size-4 text-primary" aria-hidden="true" />
        {result.kind.label} near you
      </p>
      <ul className="mt-2 space-y-1">
        {result.places.map((p) => (
          <li key={p.osm} className="flex items-baseline justify-between gap-3 text-sm">
            {OSM_OBJECT.test(p.osm) ? (
              <a
                href={`https://www.openstreetmap.org/${p.osm}`}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 truncate underline-offset-2 hover:underline focus-visible:underline"
              >
                {p.name}
              </a>
            ) : (
              <span className="min-w-0 truncate">{p.name}</span>
            )}
            <span className="shrink-0 text-muted-foreground">about {distanceLabel(p.distance_m)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">
        Map data ©{' '}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline underline-offset-2">
          OpenStreetMap contributors
        </a>
        . Volunteers keep it up to date, so check a place is open before you go.
      </p>
    </section>
  )
}
