import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { HistoryItem, ProfileStats } from '@/shared/api'
import { Button } from '@/components/ui/button'
import { ApiError, getHistory, getProfile } from '@/lib/api'
import { summarizeLearning } from '@/lib/insights'
import { cn } from '@/lib/utils'

const OUTCOME_LABEL: Record<HistoryItem['outcome'], string> = {
  completed: 'Did it',
  partial: 'Part of it',
  skipped: 'Did not go',
  changed: 'Swapped',
  pending: 'Waiting for your answer',
}

/**
 * Timestamps are stored as the person's own wall-clock time ("2026-10-07T17:42:00+05:30").
 * Show exactly that clock time, whatever time zone this browser is in.
 */
function when(ts: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(ts)
  if (!m) return ts
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])))
  return new Intl.DateTimeFormat('en', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }).format(d)
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl border bg-card p-4">
      <p className="font-display text-3xl font-medium tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

export default function History() {
  const [items, setItems] = useState<HistoryItem[] | null>(null)
  const [stats, setStats] = useState<ProfileStats | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const ac = new AbortController()
    getHistory(50, ac.signal)
      .then((r) => setItems(r.items))
      .catch((err: unknown) => {
        if (!ac.signal.aborted) setError(err instanceof ApiError ? err.message : 'Could not load your history.')
      })
    getProfile(ac.signal)
      .then((p) => setStats(p?.stats ?? null))
      .catch(() => {})
    return () => ac.abort()
  }, [])

  // What actually worked: activities the person completed, most often first. Real events only.
  const worked = useMemo(() => {
    const counts = new Map<string, { title: string; n: number; rated: number[] }>()
    for (const i of items ?? []) {
      if (i.outcome !== 'completed') continue
      const e = counts.get(i.activity_id) ?? { title: i.title, n: 0, rated: [] }
      e.n += 1
      if (i.enjoyment !== null) e.rated.push(i.enjoyment)
      counts.set(i.activity_id, e)
    }
    return [...counts.values()].sort((a, b) => b.n - a.n).slice(0, 5)
  }, [items])

  const noticed = useMemo(() => summarizeLearning(items ?? []), [items])

  return (
    <section className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-medium tracking-tight">What actually worked</h1>
        <p className="mt-2 text-muted-foreground">Only what you told us. No streaks, no scores to chase.</p>
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-destructive/40 bg-card px-4 py-3 text-sm">
          {error}
        </p>
      )}

      {items === null && !error && (
        <div aria-busy="true" aria-hidden="true" className="grid animate-pulse grid-cols-2 gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 rounded-2xl border bg-card" />
          ))}
        </div>
      )}

      {items !== null && items.length === 0 && (
        <div className="space-y-3 rounded-2xl border bg-card p-6">
          <h2 className="font-display text-xl font-medium">Nothing here yet</h2>
          <p className="text-muted-foreground">After your first mission, the things that worked for you will show up here.</p>
          <Button asChild>
            <Link to="/plan">Plan a mission</Link>
          </Button>
        </div>
      )}

      {items !== null && items.length > 0 && (
        <>
          {stats && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Tile value={String(stats.recommendations)} label="missions suggested" />
              <Tile value={String(stats.responded)} label="answered" />
              <Tile value={String(stats.completed)} label="finished" />
              <Tile value={stats.completion_rate === null ? '–' : `${Math.round(stats.completion_rate * 100)}%`} label="of answered missions finished" />
            </div>
          )}

          {noticed.length > 0 && (
            <div className="space-y-3">
              <h2 className="font-display text-xl font-medium">What we have noticed</h2>
              <ul className="space-y-2 rounded-2xl border bg-card p-4 text-sm">
                {noticed.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">Worked out from your own answers only, and it changes as you answer more.</p>
            </div>
          )}

          {worked.length > 0 && (
            <div className="space-y-3">
              <h2 className="font-display text-xl font-medium">Things you finish</h2>
              <ul className="divide-y rounded-2xl border bg-card">
                {worked.map((w) => (
                  <li key={w.title} className="flex items-center justify-between gap-4 px-4 py-3">
                    <span>{w.title}</span>
                    <span className="shrink-0 text-sm text-muted-foreground">
                      {w.n}×{w.rated.length > 0 && ` · ${(w.rated.reduce((a, b) => a + b, 0) / w.rated.length).toFixed(1)}/5`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-3">
            <h2 className="font-display text-xl font-medium">Recent</h2>
            <ol className="space-y-2">
              {items.map((i) => (
                <li key={i.recommendation_id} className="flex items-start gap-3 rounded-xl border bg-card px-4 py-3">
                  <span
                    aria-hidden="true"
                    className={cn(
                      'mt-1.5 size-2.5 shrink-0 rounded-full',
                      i.outcome === 'completed' && 'bg-primary',
                      i.outcome === 'partial' && 'bg-primary/50',
                      (i.outcome === 'skipped' || i.outcome === 'changed') && 'bg-muted-foreground/40',
                      i.outcome === 'pending' && 'border border-primary/60',
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{i.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {when(i.timestamp)} · {OUTCOME_LABEL[i.outcome]}
                      {i.enjoyment !== null && ` · ${i.enjoyment}/5`}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </>
      )}
    </section>
  )
}
