import { useEffect, useState, type FormEvent } from 'react'
import { LocateFixed, MapPin, Search, X } from 'lucide-react'
import type { ConditionsSummary, PlaceResult } from '@/shared/context'
import { Button } from '@/components/ui/button'
import { ApiError, getConditions, searchPlaces } from '@/lib/api'
import { LocationError, clearPlace, requestDeviceLocation, savePlace, type SavedPlace } from '@/lib/location'
import { WEATHER_LABELS } from '@/lib/vocab'
import { ContextPill } from './ContextPill'

type Props = {
  place: SavedPlace | null
  onChange: (place: SavedPlace | null) => void
  disabled?: boolean
}

type Conditions = { status: 'idle' } | { status: 'loading' } | { status: 'ready'; value: ConditionsSummary } | { status: 'unavailable' }

/**
 * Optional "where are you?" so the plan can use the real weather and daylight.
 * Nothing is requested until the person taps; the choice is kept only in this browser.
 */
export function LocationPicker({ place, onChange, disabled }: Props) {
  const [conditions, setConditions] = useState<Conditions>({ status: 'idle' })
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PlaceResult[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  // Show what it is like outside whenever a place is set.
  const lat = place?.lat
  const lon = place?.lon
  useEffect(() => {
    if (lat === undefined || lon === undefined) {
      setConditions({ status: 'idle' })
      return
    }
    const ac = new AbortController()
    setConditions({ status: 'loading' })
    getConditions({ lat, lon }, ac.signal)
      .then((r) => setConditions(r.available && r.conditions ? { status: 'ready', value: r.conditions } : { status: 'unavailable' }))
      .catch((err) => {
        if (!(err instanceof ApiError && err.code === 'cancelled')) setConditions({ status: 'unavailable' })
      })
    return () => ac.abort()
  }, [lat, lon])

  function choose(next: SavedPlace) {
    savePlace(next)
    onChange(next)
    setSearching(false)
    setResults(null)
    setQuery('')
    setMessage(null)
  }

  async function useDevice() {
    setBusy(true)
    setMessage(null)
    try {
      const loc = await requestDeviceLocation()
      choose({ ...loc, label: 'Near you', source: 'device' })
    } catch (err) {
      setMessage(err instanceof LocationError ? err.message : 'Could not get your location.')
    } finally {
      setBusy(false)
    }
  }

  async function search(e: FormEvent) {
    e.preventDefault()
    if (query.trim().length < 2) return
    setBusy(true)
    setMessage(null)
    try {
      const r = await searchPlaces(query.trim())
      if (!r.available) setMessage('City search is unavailable right now. Try again in a moment.')
      else if (r.places.length === 0) setMessage('No city found with that name.')
      setResults(r.available ? r.places : null)
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Search failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  function remove() {
    clearPlace()
    onChange(null)
    setMessage(null)
  }

  return (
    <div>
      <p className="mb-2 text-sm font-medium">Where are you? <span className="font-normal text-muted-foreground">(optional)</span></p>

      {place ? (
        <div className="flex flex-wrap items-center gap-2">
          <ContextPill icon={MapPin}>{place.label}</ContextPill>
          {conditions.status === 'loading' && <ContextPill className="animate-pulse">Checking the sky…</ContextPill>}
          {conditions.status === 'ready' && (
            <>
              <ContextPill>
                {WEATHER_LABELS[conditions.value.weather.category]}, {conditions.value.weather.temp_c}°C
              </ContextPill>
              <ContextPill>{conditions.value.daylight === 'day' ? 'Daylight' : 'After dark'}</ContextPill>
              {conditions.value.sunset && conditions.value.sunrise && (
                <ContextPill>
                  Sun {conditions.value.sunrise}–{conditions.value.sunset}
                </ContextPill>
              )}
            </>
          )}
          {conditions.status === 'unavailable' && <ContextPill>Weather unavailable, planning without it</ContextPill>}
          <Button variant="ghost" size="sm" onClick={remove} disabled={disabled}>
            <X className="size-4" aria-hidden="true" /> Remove
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => void useDevice()} disabled={disabled || busy}>
              <LocateFixed className="size-4" aria-hidden="true" /> Use my location
            </Button>
            <Button variant="outline" size="sm" onClick={() => setSearching((s) => !s)} disabled={disabled || busy} aria-expanded={searching}>
              <Search className="size-4" aria-hidden="true" /> Search a city
            </Button>
          </div>
          {searching && (
            <form onSubmit={(e) => void search(e)} className="flex gap-2">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                maxLength={60}
                placeholder="City name"
                aria-label="City name"
                className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button type="submit" size="sm" disabled={busy || query.trim().length < 2}>
                Search
              </Button>
            </form>
          )}
          {results && results.length > 0 && (
            <ul className="space-y-1">
              {results.map((p) => (
                <li key={`${p.lat},${p.lon},${p.name}`}>
                  <button
                    type="button"
                    onClick={() => choose({ lat: p.lat, lon: p.lon, label: [p.name, p.region].filter(Boolean).join(', '), source: 'search' })}
                    className="w-full rounded-lg border bg-card px-3 py-2 text-left text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {p.name}
                    <span className="text-muted-foreground">{[p.region, p.country].filter(Boolean).map((s) => `, ${s}`).join('')}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            Used only to look up the weather and daylight. Rounded to about 1 km, sent to Open-Meteo, never saved on our servers, and
            remembered only in this browser. You can remove it any time.
          </p>
        </div>
      )}

      {message && (
        <p role="status" className="mt-2 text-sm text-muted-foreground">
          {message}
        </p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Weather data by{' '}
        <a href="https://open-meteo.com/" target="_blank" rel="noreferrer" className="underline underline-offset-2">
          Open-Meteo.com
        </a>
      </p>
    </div>
  )
}
