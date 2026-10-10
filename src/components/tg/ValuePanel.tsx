import { useEffect, useState } from 'react'
import type { MetricsResponse } from '@/shared/api'
import { getMetrics } from '@/lib/api'

/**
 * "How is this going?", measured in real-world terms: did missions turn into real attempts, did they feel worthwhile,
 * did you pick it back up after a missed one. There is deliberately nothing about time in the app, and no streaks.
 */
export function ValuePanel() {
  const [data, setData] = useState<MetricsResponse | null>(null)

  useEffect(() => {
    const ac = new AbortController()
    getMetrics(ac.signal)
      .then(setData)
      .catch(() => {})
    return () => ac.abort()
  }, [])

  if (!data || data.lines.length === 0) return null

  return (
    <details className="group rounded-2xl border bg-card p-4">
      <summary className="cursor-pointer list-none font-display text-lg font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        How is it going, in real life?
      </summary>
      <ul className="mt-3 space-y-2 text-sm">
        {data.lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">This is about what you did outside, never about how long you spend in the app.</p>
    </details>
  )
}
