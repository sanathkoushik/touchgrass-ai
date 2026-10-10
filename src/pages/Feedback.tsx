import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check, Minus, Shuffle, SkipForward } from 'lucide-react'
import type { FeedbackResponse, ProfileStats } from '@/shared/api'
import type { Feeling, Helper, Outcome, SkipReason, WouldRepeat } from '@/shared/engine/types'
import type { PlanPrefill } from '@/shared/next-step'
import { questsFor } from '@/shared/quests'
import { Celebration } from '@/components/tg/Celebration'
import { ChoiceGroup } from '@/components/tg/ChoiceGroup'
import { FeedbackButton } from '@/components/tg/FeedbackButton'
import { MemoryNote } from '@/components/tg/MemoryNote'
import { PreferenceChip } from '@/components/tg/PreferenceChip'
import { PrimaryAction } from '@/components/tg/PrimaryAction'
import { RecognitionCard } from '@/components/tg/RecognitionCard'
import { ReflectionQuestions } from '@/components/tg/ReflectionQuestions'
import { Button } from '@/components/ui/button'
import { ApiError, getHistory, getProfile, sendFeedback } from '@/lib/api'
import { clearMission, loadMission, minutesAway } from '@/lib/mission-store'
import { queueNextPlan } from '@/lib/next-plan'
import { keepPhoto } from '@/lib/photos'
import { cn } from '@/lib/utils'
import { SKIP_REASON_LABELS } from '@/lib/vocab'

interface Target {
  /** True when the server could not save this mission (storage was down), so there is nothing to answer on the server. */
  unsaved?: boolean
  id: string
  activityId?: string
  title: string
  firstStep?: string
  /** Minutes since they tapped "Let's go", if we know. */
  measured: number | null
  /** When they set off (epoch ms), if we know. */
  wentAt?: number
  /** The side quests they ticked while out. */
  questsTicked: boolean[]
  /** The Mission Companion or the earlier plain flow (the experiment switch). */
  classic: boolean
}

const OUTCOMES: { value: Outcome; label: string; icon: typeof Check }[] = [
  { value: 'completed', label: 'Did it', icon: Check },
  { value: 'partial', label: 'Part of it', icon: Minus },
  { value: 'skipped', label: 'Did not go', icon: SkipForward },
  { value: 'changed', label: 'Did something else', icon: Shuffle },
]

const ENJOYMENT = [
  { value: 1, label: '1', hint: 'Meh' },
  { value: 2, label: '2' },
  { value: 3, label: '3', hint: 'Fine' },
  { value: 4, label: '4' },
  { value: 5, label: '5', hint: 'Great' },
]

const THANKS: Record<Outcome, string> = {
  completed: 'Nice. That counts.',
  partial: 'Part of it still counts.',
  skipped: 'No problem. That tells us something useful.',
  changed: 'Good to know. We will take that into account.',
}

const STANDARD_MINUTES = [10, 15, 20, 30, 45, 60, 90, 120]
/** Beyond this, "minutes since you set off" is probably a phone left on a shelf, so we ask instead of assuming. */
const MAX_BELIEVABLE_MINUTES = 300

/** The measured time, if it is believable. */
const usableMeasured = (m: number | null) => (m !== null && m >= 1 && m <= MAX_BELIEVABLE_MINUTES ? m : null)

function minuteOptions(measured: number | null) {
  const usable = usableMeasured(measured)
  const list = usable !== null ? [...new Set([usable, ...STANDARD_MINUTES])].sort((a, b) => a - b) : STANDARD_MINUTES
  return list.map((value) => ({
    value,
    label: value >= 60 && value % 60 === 0 ? `${value / 60} h` : `${value} min`,
    ...(value === usable ? { hint: 'Since you set off' } : {}),
  }))
}

type Done = {
  outcome: Outcome
  enjoyment: number | null
  stats: ProfileStats | null
  unsaved?: boolean
  response?: FeedbackResponse
  keptMemory: boolean
}

export default function Feedback() {
  const navigate = useNavigate()
  const [target, setTarget] = useState<Target | null | 'loading'>(() => {
    const m = loadMission()
    return m
      ? {
          id: m.recommendation.recommendation_id,
          activityId: m.recommendation.activity_id,
          title: m.recommendation.title,
          firstStep: m.recommendation.first_step,
          unsaved: m.recommendation.persisted === false,
          measured: minutesAway(m),
          ...(m.wentAt ? { wentAt: m.wentAt } : {}),
          questsTicked: m.questsTicked ?? [],
          classic: m.recommendation.flow === 'classic',
        }
      : 'loading'
  })
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [enjoyment, setEnjoyment] = useState<number | null>(null)
  const [reason, setReason] = useState<SkipReason | null>(null)
  const [minutes, setMinutes] = useState<number | null>(() => usableMeasured(minutesAway(loadMission())))
  const [ticks, setTicks] = useState<boolean[]>(() => loadMission()?.questsTicked ?? [])
  const [feeling, setFeeling] = useState<Feeling | null>(null)
  const [helper, setHelper] = useState<Helper | null>(null)
  const [barrier, setBarrier] = useState<SkipReason | null>(null)
  const [wouldRepeat, setWouldRepeat] = useState<WouldRepeat | null>(null)
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<Done | null>(null)

  // Nothing saved in this browser? Ask the server for the most recent unanswered mission.
  useEffect(() => {
    if (target !== 'loading') return
    const ac = new AbortController()
    getHistory(10, ac.signal)
      .then(({ items }) => {
        const pending = items.find((i) => i.outcome === 'pending')
        setTarget(pending ? { id: pending.recommendation_id, activityId: pending.activity_id, title: pending.title, measured: null, questsTicked: [], classic: false } : null)
      })
      .catch(() => {
        if (!ac.signal.aborted) setTarget(null)
      })
    return () => ac.abort()
  }, [target])

  function toggleTick(i: number) {
    setTicks((t) => {
      const next = [...t]
      while (next.length <= i) next.push(false)
      next[i] = !next[i]
      return next
    })
  }

  async function submit() {
    if (target === 'loading' || target === null || !outcome) return
    setSaving(true)
    setError(null)
    if (target.unsaved) {
      // Nothing to update on the server: be honest, and do not make the person retry something that cannot work.
      clearMission()
      setDone({ outcome, enjoyment, stats: null, unsaved: true, keptMemory: false })
      return
    }
    const credited = outcome === 'completed' || outcome === 'partial'
    const quests = target.activityId ? questsFor(target.activityId, target.id) : []
    const questsDone = quests.filter((_, i) => ticks[i]).length
    const reflect = credited && !target.classic

    try {
      // The photo is kept on THIS device only; the server is told just whether one exists.
      const hasPhoto = reflect && photo ? await keepPhoto(target.id, photo) : false
      const cleanNote = note.trim()
      const measured = usableMeasured(target.measured)

      const res = await sendFeedback({
        recommendation_id: target.id,
        outcome,
        ...(enjoyment && credited ? { enjoyment } : {}),
        ...(reason && (outcome === 'skipped' || outcome === 'changed') ? { skip_reason: reason } : {}),
        ...(credited && minutes !== null ? { minutes_outside: minutes, minutes_source: minutes === measured ? ('measured' as const) : ('stated' as const) } : {}),
        ...(credited ? { quests_done: questsDone } : {}),
        ...(credited && target.wentAt ? { started_at: new Date(target.wentAt).toISOString() } : {}),
        ...(reflect && feeling ? { feeling } : {}),
        ...(reflect && helper ? { helper } : {}),
        ...(reflect && barrier ? { barrier } : {}),
        ...(reflect && wouldRepeat ? { would_repeat: wouldRepeat } : {}),
        ...(reflect && cleanNote ? { note: cleanNote } : {}),
        ...(hasPhoto ? { has_photo: true } : {}),
      })
      clearMission()
      // Real numbers only: what the server has actually recorded for this person.
      const stats = await getProfile()
        .then((p) => p?.stats ?? null)
        .catch(() => null)
      setDone({ outcome, enjoyment: enjoyment && credited ? enjoyment : null, stats, response: res, keptMemory: !!cleanNote || hasPhoto })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that. Please try again.')
      setSaving(false)
    }
  }

  const tryNextStep = (plan: PlanPrefill) => {
    queueNextPlan(plan)
    navigate('/plan')
  }

  if (done) {
    const res = done.response
    if (res?.reward && (done.outcome === 'completed' || done.outcome === 'partial')) {
      return (
        <Celebration
          outcome={done.outcome}
          enjoyment={done.enjoyment}
          reward={res.reward}
          adaptations={res.adaptations}
          askToAvoid={res.ask_to_avoid}
          keptMemory={done.keptMemory}
          onNext={() => navigate('/plan')}
        />
      )
    }
    if (res?.recognition && (done.outcome === 'skipped' || done.outcome === 'changed')) {
      return <RecognitionCard outcome={done.outcome} recognition={res.recognition} nextStep={res.next_step} onTry={tryNextStep} onNext={() => navigate('/plan')} />
    }
    const s = done.stats
    return (
      <section className="space-y-6">
        <div className="space-y-3 rounded-2xl border bg-card p-6">
          <h1 className="font-display text-3xl font-medium tracking-tight">{THANKS[done.outcome]}</h1>
          {done.unsaved && (
            <p className="text-muted-foreground">
              Your saved history was out of reach when this idea was made, so this one was not recorded. Thank you for telling us anyway.
            </p>
          )}
          {s && s.responded > 0 && (
            <p className="text-muted-foreground">
              So far you have finished <strong className="text-foreground">{s.completed}</strong> of the{' '}
              <strong className="text-foreground">{s.responded}</strong> missions you have answered. Your next idea will use this.
            </p>
          )}
          <p className="text-muted-foreground">Your meadow stays exactly as it was. Nothing is ever taken away.</p>
          <div className="flex flex-wrap gap-3 pt-2">
            <PrimaryAction onClick={() => navigate('/plan')}>Plan the next one</PrimaryAction>
            <Button asChild variant="ghost">
              <Link to="/history">See my meadow</Link>
            </Button>
          </div>
        </div>
      </section>
    )
  }

  if (target === 'loading') {
    return (
      <section aria-busy="true" className="space-y-4">
        <h1 className="font-display text-3xl font-medium tracking-tight">How did it go?</h1>
        <div aria-hidden="true" className="h-40 animate-pulse rounded-2xl border bg-card" />
      </section>
    )
  }

  if (target === null) {
    return (
      <section className="space-y-4">
        <h1 className="font-display text-3xl font-medium tracking-tight">Nothing waiting for you</h1>
        <p className="text-muted-foreground">When you have been out on a mission, come back here and tell us how it went in a few seconds.</p>
        <Button asChild>
          <Link to="/plan">Plan a mission</Link>
        </Button>
      </section>
    )
  }

  const rating = outcome === 'completed' || outcome === 'partial'
  const why = outcome === 'skipped' || outcome === 'changed'
  const quests = target.activityId ? questsFor(target.activityId, target.id) : []

  return (
    <section className="space-y-7">
      <div>
        <h1 className="font-display text-3xl font-medium tracking-tight">How did it go?</h1>
        <p className="mt-2 text-muted-foreground">
          You were going to: <strong className="font-medium text-foreground">{target.title}</strong>
        </p>
      </div>

      <div role="radiogroup" aria-label="What happened" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {OUTCOMES.map((o) => (
          <FeedbackButton key={o.value} icon={o.icon} selected={outcome === o.value} onClick={() => setOutcome(o.value)} disabled={saving}>
            {o.label}
          </FeedbackButton>
        ))}
      </div>

      {rating && (
        <>
          <div className="space-y-2">
            <p className="text-sm font-medium">
              About how long were you out? <span className="font-normal text-muted-foreground">(it goes into your meadow)</span>
            </p>
            <ChoiceGroup label="Time spent" options={minuteOptions(target.measured)} value={minutes ?? undefined} onChange={setMinutes} disabled={saving} />
          </div>

          {!target.classic && (
            <ReflectionQuestions
              missionId={target.id}
              feeling={feeling}
              onFeeling={setFeeling}
              helper={helper}
              onHelper={setHelper}
              barrier={barrier}
              onBarrier={setBarrier}
              wouldRepeat={wouldRepeat}
              onWouldRepeat={setWouldRepeat}
              disabled={saving}
            />
          )}

          {quests.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">
                Did you try the little prompt? <span className="font-normal text-muted-foreground">(optional)</span>
              </p>
              <ul className="space-y-2">
                {quests.map((q, i) => (
                  <li key={q}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={ticks[i] === true}
                      disabled={saving}
                      onClick={() => toggleTick(i)}
                      className={cn(
                        'flex min-h-12 w-full items-center gap-3 rounded-xl border px-4 py-2.5 text-left text-sm outline-none transition-all',
                        'focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99] disabled:opacity-50',
                        ticks[i] ? 'border-primary/60 bg-primary/15 text-foreground' : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn('grid size-6 shrink-0 place-items-center rounded-full border transition-all', ticks[i] ? 'border-primary bg-primary text-primary-foreground' : 'border-border')}
                      >
                        {ticks[i] && <Check className="size-3.5" strokeWidth={3} />}
                      </span>
                      {q}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-sm font-medium">
              How much did you enjoy it? <span className="font-normal text-muted-foreground">(optional)</span>
            </p>
            <div role="radiogroup" aria-label="Enjoyment from 1 to 5" className="flex gap-2">
              {ENJOYMENT.map((e) => (
                <button
                  key={e.value}
                  type="button"
                  role="radio"
                  aria-checked={enjoyment === e.value}
                  onClick={() => setEnjoyment(e.value)}
                  disabled={saving}
                  className={
                    'min-w-14 rounded-xl border px-3 py-2 text-center text-sm transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95 ' +
                    (enjoyment === e.value ? 'border-primary/60 bg-primary/15 text-foreground' : 'border-border bg-card text-muted-foreground hover:bg-accent')
                  }
                >
                  <span className="block font-medium">{e.label}</span>
                  <span className="block text-[10px] text-muted-foreground">{e.hint ?? ' '}</span>
                </button>
              ))}
            </div>
          </div>

          {!target.classic && <MemoryNote note={note} onNote={setNote} photo={photo} onPhoto={setPhoto} disabled={saving} />}
        </>
      )}

      {why && (
        <div className="space-y-2">
          <p className="text-sm font-medium">
            What got in the way? <span className="font-normal text-muted-foreground">(optional)</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(SKIP_REASON_LABELS) as SkipReason[]).map((r) => (
              <PreferenceChip key={r} selected={reason === r} onToggle={() => setReason(reason === r ? null : r)} disabled={saving}>
                {SKIP_REASON_LABELS[r]}
              </PreferenceChip>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">Whatever the reason, it is fine. We will suggest something smaller next.</p>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-xl border border-destructive/40 bg-card px-4 py-3 text-sm">
          {error}
        </p>
      )}

      <PrimaryAction onClick={() => void submit()} disabled={!outcome} isLoading={saving} loadingText="Saving…">
        Save
      </PrimaryAction>
    </section>
  )
}
