import { useCallback, useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import { Link, useNavigate } from 'react-router-dom'
import { Clock, Footprints, Sparkles, User, Users } from 'lucide-react'
import type { LearnedResponse, RecommendResponse } from '@/shared/api'
import type { ActivityMode, DesiredOutcome, Mood, SkipReason, SocialMode } from '@/shared/engine/types'
import type { Companion } from '@/shared/engine/types'
import type { PlanPrefill } from '@/shared/next-step'
import { AssistantSuggestion } from '@/components/tg/AssistantSuggestion'
import { CheckinCard } from '@/components/tg/CheckinCard'
import { CompanionAlternative, CompanionNote } from '@/components/tg/CompanionPanel'
import { ContextPill } from '@/components/tg/ContextPill'
import { GoingCard } from '@/components/tg/GoingCard'
import { MissionCard } from '@/components/tg/MissionCard'
import { NearbyPlaces } from '@/components/tg/NearbyPlaces'
import { PreferenceChip } from '@/components/tg/PreferenceChip'
import { PrimaryAction } from '@/components/tg/PrimaryAction'
import { Button } from '@/components/ui/button'
import { useMission, type PlanContext } from '@/hooks/useMission'
import { useProfile } from '@/hooks/useProfile'
import { getLearned } from '@/lib/api'
import { loadCheckin, saveCheckin, socialAvailable, type Company } from '@/lib/checkin'
import { loadPlace, type SavedPlace } from '@/lib/location'
import { takeNextPlan } from '@/lib/next-plan'
import { DURATION_OPTIONS_FOR_PLAN, MODE_PILL, SKIP_REASON_LABELS, WEATHER_LABELS } from '@/lib/vocab'

const MODE_LABEL: Record<SocialMode, string> = { solo: 'On your own', with_friend: 'With a friend', small_group: 'Small group' }

function nearest(options: readonly number[], target: number): number {
  return options.reduce((best, o) => (Math.abs(o - target) < Math.abs(best - target) ? o : best), options[0] ?? target)
}

/** A mission saved in this browser before the companion existed has no companion; the screen must cope with that. */
const companionOf = (rec: RecommendResponse): Companion | undefined => (rec as Partial<RecommendResponse>).companion

function Skeleton() {
  // Same footprint as the real card, so nothing jumps when the pick arrives.
  return (
    <div aria-hidden="true" className="min-h-[19rem] animate-pulse rounded-2xl border bg-card p-6">
      <div className="h-6 w-24 rounded-full bg-muted" />
      <div className="mt-5 h-8 w-3/4 rounded-md bg-muted" />
      <div className="mt-3 h-4 w-full rounded bg-muted" />
      <div className="mt-2 h-4 w-2/3 rounded bg-muted" />
      <div className="mt-6 h-20 rounded-xl bg-muted/70" />
    </div>
  )
}

function Meta({ rec, upgrading }: { rec: RecommendResponse; upgrading: boolean }) {
  return (
    <>
      <ContextPill icon={Clock}>{rec.duration_min} min</ContextPill>
      <ContextPill icon={rec.social_mode === 'solo' ? User : Users}>{MODE_LABEL[rec.social_mode]}</ContextPill>
      {MODE_PILL[rec.mode] && <ContextPill icon={Footprints}>{MODE_PILL[rec.mode]}</ContextPill>}
      {rec.context && (
        <ContextPill>
          {WEATHER_LABELS[rec.context.weather.category]}, {rec.context.weather.temp_c}°C · {rec.context.daylight === 'day' ? 'daylight' : 'after dark'}
        </ContextPill>
      )}
      {upgrading ? (
        <ContextPill icon={Sparkles} className="animate-pulse">
          Personalizing…
        </ContextPill>
      ) : rec.source === 'ai' ? (
        <ContextPill icon={Sparkles}>Personalized for you</ContextPill>
      ) : null}
    </>
  )
}

export default function Plan() {
  const navigate = useNavigate()
  const { state: profile } = useProfile()
  const { phase, plan, go, swap, reset } = useMission()

  // A ready-made check-in handed over by "Try this" (a smaller next step, or something the assistant noticed). Read once.
  const [queued] = useState<PlanPrefill | null>(() => takeNextPlan())
  const remembered = useRef(loadCheckin()).current

  const [minutes, setMinutes] = useState<number>(() => (queued ? nearest(DURATION_OPTIONS_FOR_PLAN, queued.duration_limit) : 60))
  const [mood, setMood] = useState<Mood>(queued?.mood ?? remembered.mood ?? 'ok')
  const [company, setCompany] = useState<Company>(() => (queued?.social_available !== undefined ? (queued.social_available ? 'together' : 'alone') : (remembered.company ?? 'alone')))
  const [outcome, setOutcome] = useState<DesiredOutcome | null>(() => (queued && 'desired_outcome' in queued ? (queued.desired_outcome ?? null) : (remembered.outcome ?? null)))
  const [mode, setMode] = useState<'auto' | ActivityMode>(queued?.mode ?? 'auto')
  const [swapOpen, setSwapOpen] = useState(false)
  const [place, setPlace] = useState<SavedPlace | null>(() => loadPlace())
  const [suggestion, setSuggestion] = useState<LearnedResponse['suggestion']>(null)
  const [suggestionGone, setSuggestionGone] = useState(false)
  const touchedMinutes = useRef(!!queued)
  const missionArea = useRef<HTMLDivElement>(null)
  const autoRan = useRef(false)
  const reduceMotion = useReducedMotion()

  const classic = profile.status === 'ready' && profile.data.flow === 'classic'

  // Start from the person's own usual duration, unless they (or "Try this") already picked one.
  useEffect(() => {
    if (profile.status === 'ready' && !touchedMinutes.current) {
      setMinutes(nearest(DURATION_OPTIONS_FOR_PLAN, profile.data.profile.preferences.preferred_duration_min))
    }
  }, [profile])

  // When a mission starts loading or appears, bring it into view so "Let's go" is never hidden below the controls.
  const kind = phase.kind
  useEffect(() => {
    if (kind === 'loading' || kind === 'going') {
      missionArea.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
    }
  }, [kind, reduceMotion])

  const buildCtx = useCallback(
    (over: { minutes?: number; mood?: Mood; company?: Company; outcome?: DesiredOutcome | null; mode?: 'auto' | ActivityMode } = {}): PlanContext => {
      const o = over.outcome === undefined ? outcome : over.outcome
      return {
        duration_limit: over.minutes ?? minutes,
        mood: over.mood ?? mood,
        social_available: socialAvailable(over.company ?? company),
        mode: over.mode ?? mode,
        ...(o && !classic ? { desired_outcome: o } : {}),
        ...(place ? { location: { lat: place.lat, lon: place.lon } } : {}),
      }
    },
    [minutes, mood, company, outcome, mode, place, classic],
  )

  /** Remember today's answers (in this browser) so tomorrow's check-in can be shorter, then plan. */
  const planNow = useCallback(
    (ctx: PlanContext) => {
      saveCheckin({ company, outcome, mood })
      void plan(ctx)
    },
    [plan, company, outcome, mood],
  )

  // "Try this": run the handed-over check-in straight away, once.
  useEffect(() => {
    if (!queued || autoRan.current || profile.status === 'loading') return
    autoRan.current = true
    if (profile.status !== 'ready') return
    planNow(buildCtx())
  }, [queued, profile.status, planNow, buildCtx])

  // Something the assistant noticed that fits right now. Quiet, optional, and never in the way.
  useEffect(() => {
    if (classic || profile.status !== 'ready') return
    const ac = new AbortController()
    getLearned(ac.signal)
      .then((l) => setSuggestion(l.suggestion))
      .catch(() => {})
    return () => ac.abort()
  }, [classic, profile.status])

  const busy = phase.kind === 'loading'
  const ctx = buildCtx()

  const tryTheSuggestion = () => {
    if (!suggestion) return
    const p = suggestion.plan
    const m = nearest(DURATION_OPTIONS_FOR_PLAN, p.duration_limit)
    setMinutes(m)
    if (p.mood) setMood(p.mood)
    if (p.mode) setMode(p.mode)
    setSuggestionGone(true)
    planNow(buildCtx({ minutes: m, mood: p.mood, mode: p.mode }))
  }

  const status =
    phase.kind === 'loading'
      ? 'Finding your mission…'
      : phase.kind === 'shown'
        ? phase.upgrading
          ? 'Your mission is ready. Personalizing the wording…'
          : phase.rec.source === 'ai'
            ? 'Your mission was personalized.'
            : 'Your mission is ready.'
        : ''

  return (
    <section className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-medium tracking-tight">Plan my next hour</h1>
        <p className="mt-2 text-muted-foreground">A quick check-in, and we will pick one thing worth leaving the screen for.</p>
      </div>

      {phase.kind === 'idle' && suggestion && !suggestionGone && !classic && (
        <AssistantSuggestion suggestion={suggestion} onTry={tryTheSuggestion} onDismiss={() => setSuggestionGone(true)} disabled={busy} />
      )}

      {phase.kind !== 'going' && (
        <CheckinCard
          minutes={minutes}
          onMinutes={(v) => {
            touchedMinutes.current = true
            setMinutes(v)
          }}
          mood={mood}
          onMood={setMood}
          company={company}
          onCompany={setCompany}
          outcome={outcome}
          onOutcome={setOutcome}
          mode={mode}
          onMode={setMode}
          place={place}
          onPlace={setPlace}
          memory={remembered}
          classic={classic}
          disabled={busy}
        />
      )}

      <p role="status" className="sr-only">
        {status}
      </p>

      <div ref={missionArea} className="scroll-mt-6 space-y-6">
        {phase.kind === 'idle' && <PrimaryAction onClick={() => planNow(ctx)}>Find my mission</PrimaryAction>}

        {phase.kind === 'loading' && <Skeleton />}

        {phase.kind === 'shown' && (
          <div className="space-y-3">
            <MissionCard
              title={phase.rec.title}
              reason={phase.rec.reason}
              lead={!classic && companionOf(phase.rec) ? <CompanionNote companion={companionOf(phase.rec)!} /> : undefined}
              firstStep={phase.rec.first_step}
              preparation={phase.rec.preparation}
              transitionKey={`${phase.rec.activity_id}|${phase.rec.source}`}
              busy={phase.upgrading}
              meta={<Meta rec={phase.rec} upgrading={phase.upgrading} />}
              actions={
                <>
                  <PrimaryAction onClick={() => go(false)}>Let's go</PrimaryAction>
                  {!classic && companionOf(phase.rec) && (
                    <Button variant="outline" onClick={() => go(true)}>
                      Just two minutes
                    </Button>
                  )}
                  <Button variant="ghost" onClick={() => setSwapOpen((o) => !o)} aria-expanded={swapOpen}>
                    Not this one
                  </Button>
                </>
              }
            />
            {!classic && companionOf(phase.rec) && <CompanionAlternative companion={companionOf(phase.rec)!} />}
            {swapOpen && (
              <div className="rounded-2xl border bg-card/60 p-4">
                <p className="mb-3 text-sm text-muted-foreground">What got in the way? It helps us choose better next time.</p>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(SKIP_REASON_LABELS) as SkipReason[]).map((r) => (
                    <PreferenceChip
                      key={r}
                      selected={false}
                      onToggle={() => {
                        setSwapOpen(false)
                        void swap(r, ctx)
                      }}
                    >
                      {SKIP_REASON_LABELS[r]}
                    </PreferenceChip>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSwapOpen(false)
                      void swap(undefined, ctx)
                    }}
                  >
                    Just show another
                  </Button>
                </div>
              </div>
            )}
            <NearbyPlaces activityId={phase.rec.activity_id} location={place ? { lat: place.lat, lon: place.lon } : null} />
            {phase.rec.persisted === false && (
              <p className="px-1 text-sm text-muted-foreground">
                This idea was made on your device because our server could not be reached, so it will not be remembered.
              </p>
            )}
            {phase.rec.fallback && (
              <p className="flex items-start gap-2 px-1 text-sm text-muted-foreground">
                <Footprints className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                <span>
                  Not up for it? A smaller idea: <strong className="font-medium text-foreground">{phase.rec.fallback.title}</strong>.
                </span>
              </p>
            )}
          </div>
        )}

        {phase.kind === 'going' && <GoingCard rec={phase.rec} onBack={() => navigate('/feedback')} onChooseAnother={reset} classic={classic} />}

        {phase.kind === 'needs_profile' && (
          <div className="rounded-2xl border bg-card p-6">
            <h2 className="font-display text-xl font-medium">First, tell us what moves you</h2>
            <p className="mt-2 text-muted-foreground">A minute of choices lets us pick things you will actually start.</p>
            <Button asChild className="mt-4">
              <Link to="/onboarding">Set my preferences</Link>
            </Button>
          </div>
        )}

        {phase.kind === 'error' && (
          <div role="alert" className="rounded-2xl border border-destructive/40 bg-card p-6">
            <h2 className="font-display text-xl font-medium">That did not work</h2>
            <p className="mt-2 text-muted-foreground">{phase.message}</p>
            <Button className="mt-4" onClick={() => planNow(ctx)}>
              Try again
            </Button>
          </div>
        )}
      </div>
    </section>
  )
}
