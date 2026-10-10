import { useEffect, useState } from 'react'
import { Check, RotateCcw } from 'lucide-react'
import type { LearnedResponse, LearnedView } from '@/shared/api'
import { Button } from '@/components/ui/button'
import { ApiError, getLearned, getProfile, patchProfile, resetLearned, respondToLearned } from '@/lib/api'
import { cn } from '@/lib/utils'

/** Plain labels for how sure we are. We never claim more than the answers support. */
const STRENGTH: Record<LearnedView['strength'], string> = { tentative: 'A first guess', consistent: 'Seems consistent' }

/**
 * What the assistant has noticed about the person, always as a guess they can correct. They can say "that's right",
 * "that's not me", take it back, remove an activity from the "never suggest" list, or start learning from scratch.
 * Nothing here deletes missions, memories or the meadow.
 */
export function LearnedPanel() {
  const [data, setData] = useState<LearnedResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)

  useEffect(() => {
    const ac = new AbortController()
    getLearned(ac.signal)
      .then(setData)
      .catch((err: unknown) => {
        if (!ac.signal.aborted) setError(err instanceof ApiError ? err.message : 'Could not load this right now.')
      })
    return () => ac.abort()
  }, [])

  async function run(key: string, action: () => Promise<LearnedResponse | void>) {
    setBusy(key)
    setError(null)
    try {
      const next = await action()
      if (next) setData(next)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not save. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  async function allowAgain(activityId: string) {
    const current = (await getProfile())?.profile.avoid_activities ?? []
    await patchProfile({ avoid_activities: current.filter((id) => id !== activityId) })
    return getLearned()
  }

  const visible = data?.items ?? []

  return (
    <section aria-labelledby="learned-heading" className="space-y-4">
      <div>
        <h2 id="learned-heading" className="font-display text-xl font-medium">
          What we have noticed about you
        </h2>
        {data && <p className="mt-1 text-sm text-muted-foreground">{data.explanation}</p>}
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-destructive/40 bg-card px-4 py-3 text-sm">
          {error}
        </p>
      )}

      {!data && !error && <div aria-hidden="true" className="h-24 animate-pulse rounded-2xl border bg-card" />}

      {data && visible.length === 0 && (
        <p className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">
          Nothing yet. After a few missions and a few answers, you will see our first guesses here, and you decide which are right.
        </p>
      )}

      {visible.length > 0 && (
        <ul className="space-y-3">
          {visible.map((i) => (
            <li key={i.id} className={cn('rounded-2xl border p-4', i.status === 'confirmed' ? 'border-primary/40 bg-primary/10' : 'bg-card', i.status === 'dismissed' && 'opacity-70')}>
              <p className={cn('text-sm font-medium', i.status === 'dismissed' && 'line-through')}>{i.text}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {STRENGTH[i.strength]} · {i.evidence}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {i.status === 'active' && (
                  <>
                    <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void run(i.id, () => respondToLearned(i.id, 'confirm'))}>
                      <Check className="size-4" aria-hidden="true" /> That is right
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void run(i.id, () => respondToLearned(i.id, 'dismiss'))}>
                      Not me
                    </Button>
                  </>
                )}
                {i.status === 'confirmed' && (
                  <>
                    <span className="text-xs font-medium text-primary">You said this is right. It is a star in your meadow.</span>
                    <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void run(i.id, () => respondToLearned(i.id, 'restore'))}>
                      Undo
                    </Button>
                  </>
                )}
                {i.status === 'dismissed' && (
                  <>
                    <span className="text-xs text-muted-foreground">You said this is not you, so we will not use it.</span>
                    <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void run(i.id, () => respondToLearned(i.id, 'restore'))}>
                      Bring it back
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {data && data.avoid.length > 0 && (
        <div className="space-y-2 rounded-2xl border bg-card p-4">
          <p className="text-sm font-medium">Things you asked us not to suggest</p>
          <ul className="space-y-1.5">
            {data.avoid.map((a) => (
              <li key={a.activity_id} className="flex items-center justify-between gap-3 text-sm">
                <span>{a.title}</span>
                <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void run(a.activity_id, () => allowAgain(a.activity_id))}>
                  Allow again
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data && (data.items.length > 0 || data.lessons.length > 0 || data.avoid.length > 0 || data.reset_at) && (
        <div className="rounded-2xl border border-dashed p-4">
          {!confirmReset ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">{data.reset_at ? 'You started learning from scratch before. You can do it again.' : 'Want a clean slate?'}</p>
              <Button size="sm" variant="outline" onClick={() => setConfirmReset(true)}>
                <RotateCcw className="size-4" aria-hidden="true" /> Start learning from scratch
              </Button>
            </div>
          ) : (
            <div role="alertdialog" aria-label="Confirm starting again" className="space-y-3">
              <p className="text-sm">
                We will forget everything we have guessed so far, and learn again only from your answers from now on. Your missions, your memories and your meadow stay exactly as they are.
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={busy !== null}
                  onClick={() =>
                    void run('reset', async () => {
                      const next = await resetLearned()
                      setConfirmReset(false)
                      return next
                    })
                  }
                >
                  Yes, start again
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmReset(false)}>
                  Keep what we have
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
