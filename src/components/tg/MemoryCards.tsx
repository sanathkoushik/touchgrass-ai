import { useEffect, useRef, useState } from 'react'
import { Clock, ImageOff } from 'lucide-react'
import type { MemoryItem } from '@/shared/mission-record'
import { SUPPORT_LABEL, NOTE_MAX } from '@/shared/mission-record'
import { formatMinutes } from '@/shared/meadow'
import { Button } from '@/components/ui/button'
import { ApiError, editMemory, getMemories } from '@/lib/api'
import { earnedOn } from '@/lib/meadow-text'
import { forgetPhoto, loadPhotoUrl } from '@/lib/photos'
import { FEELING_LABELS, PARTICIPATION_LABELS } from '@/lib/vocab'

const SHOWN_AT_FIRST = 6

/**
 * The missions that happened, as memory cards: what you did, how it felt, and anything you wrote down. You can rewrite
 * or remove a note any time. A photo lives only on this device, so it shows here and nowhere else.
 */
export function MemoryCards() {
  const [items, setItems] = useState<MemoryItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [all, setAll] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [photos, setPhotos] = useState<Record<string, string | null>>({})
  const urls = useRef<string[]>([])

  useEffect(() => {
    const ac = new AbortController()
    getMemories(60, ac.signal)
      .then((r) => setItems(r.items))
      .catch((err: unknown) => {
        if (!ac.signal.aborted) setError(err instanceof ApiError ? err.message : 'Could not load your memories.')
      })
    return () => ac.abort()
  }, [])

  // Photos are read from THIS device only. Free the temporary addresses when leaving.
  useEffect(() => {
    if (!items) return
    let cancelled = false
    for (const m of items) {
      if (!m.has_photo || m.mission_id in photos) continue
      void loadPhotoUrl(m.mission_id).then((url) => {
        if (url) urls.current.push(url)
        if (!cancelled) setPhotos((p) => ({ ...p, [m.mission_id]: url }))
        else if (url) URL.revokeObjectURL(url)
      })
    }
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), [])

  async function save(id: string, note: string | null) {
    setSaving(true)
    setError(null)
    try {
      const { item } = await editMemory(id, { note })
      setItems((list) => list?.map((m) => (m.mission_id === id ? item : m)) ?? null)
      setEditing(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function removePhoto(item: MemoryItem) {
    setSaving(true)
    try {
      await forgetPhoto(item.mission_id)
      const { item: next } = await editMemory(item.mission_id, { has_photo: false })
      setItems((list) => list?.map((m) => (m.mission_id === item.mission_id ? next : m)) ?? null)
    } catch {
      setError('Could not remove the photo. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const shown = items ? (all ? items : items.slice(0, SHOWN_AT_FIRST)) : []

  return (
    <section aria-labelledby="memories-heading" className="space-y-4">
      <div>
        <h2 id="memories-heading" className="font-display text-xl font-medium">
          Your memories
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">The missions you did, and what you wanted to remember about them. Only you can see these.</p>
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-destructive/40 bg-card px-4 py-3 text-sm">
          {error}
        </p>
      )}
      {!items && !error && <div aria-hidden="true" className="h-24 animate-pulse rounded-2xl border bg-card" />}
      {items && items.length === 0 && <p className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">After your first mission, it will be here, and you can add a few words to remember it by.</p>}

      <ul className="grid gap-3 sm:grid-cols-2">
        {shown.map((m) => (
          <li key={m.mission_id} className="flex flex-col gap-2 rounded-2xl border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">{m.title}</p>
                <p className="text-xs text-muted-foreground">
                  {earnedOn(m.timestamp)} · {PARTICIPATION_LABELS[m.participation]}
                </p>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border bg-secondary/60 px-2 py-0.5 text-xs text-secondary-foreground">
                <Clock className="size-3" aria-hidden="true" /> {formatMinutes(m.minutes)}
              </span>
            </div>

            {m.feeling && <p className="text-xs text-primary">Felt {FEELING_LABELS[m.feeling].toLowerCase()} afterwards</p>}

            {editing === m.mission_id ? (
              <div className="space-y-2">
                <label htmlFor={`note-${m.mission_id}`} className="sr-only">
                  Your note about {m.title}
                </label>
                <textarea
                  id={`note-${m.mission_id}`}
                  value={draft}
                  maxLength={NOTE_MAX}
                  rows={3}
                  onChange={(e) => setDraft(e.target.value.slice(0, NOTE_MAX))}
                  className="w-full resize-none rounded-xl border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" disabled={saving} onClick={() => void save(m.mission_id, draft.trim() || null)}>
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" disabled={saving} onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                    {draft.length}/{NOTE_MAX}
                  </span>
                </div>
              </div>
            ) : m.note ? (
              <p className="text-sm leading-relaxed">“{m.note}”</p>
            ) : null}

            {m.has_photo &&
              (photos[m.mission_id] ? (
                <img src={photos[m.mission_id]!} alt={`Your photo from ${m.title}`} className="aspect-[4/3] w-full rounded-xl border object-cover" />
              ) : m.mission_id in photos ? (
                <p className="flex items-center gap-2 rounded-xl border border-dashed p-3 text-xs text-muted-foreground">
                  <ImageOff className="size-4 shrink-0" aria-hidden="true" /> This photo is on another device (photos are never uploaded).
                </p>
              ) : (
                <div aria-hidden="true" className="aspect-[4/3] w-full animate-pulse rounded-xl bg-muted" />
              ))}

            <p className="text-[11px] text-muted-foreground">{SUPPORT_LABEL[m.support]}</p>

            {editing !== m.mission_id && (
              <div className="mt-auto flex flex-wrap gap-2 pt-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setDraft(m.note ?? '')
                    setEditing(m.mission_id)
                  }}
                >
                  {m.note ? 'Edit note' : 'Add a few words'}
                </Button>
                {m.note && (
                  <Button size="sm" variant="ghost" disabled={saving} onClick={() => void save(m.mission_id, null)}>
                    Remove note
                  </Button>
                )}
                {m.has_photo && photos[m.mission_id] && (
                  <Button size="sm" variant="ghost" disabled={saving} onClick={() => void removePhoto(m)}>
                    Remove photo
                  </Button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {items && items.length > SHOWN_AT_FIRST && (
        <Button variant="outline" size="sm" onClick={() => setAll((a) => !a)}>
          {all ? 'Show fewer' : `Show all ${items.length}`}
        </Button>
      )}
    </section>
  )
}
