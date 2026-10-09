import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import { Link, useNavigate } from 'react-router-dom'
import { Clock, Footprints, Sparkles, User, Users } from 'lucide-react'
import type { RecommendResponse } from '@/shared/api'
import type { Mood, SkipReason, SocialMode } from '@/shared/engine/types'
import { ChoiceGroup } from '@/components/tg/ChoiceGroup'
import { ContextPill } from '@/components/tg/ContextPill'
import { MissionCard } from '@/components/tg/MissionCard'
import { PreferenceChip } from '@/components/tg/PreferenceChip'
import { PrimaryAction } from '@/components/tg/PrimaryAction'
import { Button } from '@/components/ui/button'
import { useMission, type PlanContext } from '@/hooks/useMission'
import { useProfile } from '@/hooks/useProfile'
import { DURATION_OPTIONS_FOR_PLAN, MOOD_LABELS, SKIP_REASON_LABELS } from '@/lib/vocab'

const MODE_LABEL: Record<SocialMode, string> = { solo: 'On your own', with_friend: 'With a friend', small_group: 'Small group' }
const MOOD_OPTIONS = (Object.keys(MOOD_LABELS) as Mood[]).map((m) => ({ value: m, label: MOOD_LABELS[m].label, hint: MOOD_LABELS[m].hint }))
const MINUTE_OPTIONS = DURATION_OPTIONS_FOR_PLAN.map((m) => ({ value: m, label: m >= 60 ? `${m / 60 === Math.floor(m / 60) ? m / 60 : (m / 60).toFixed(1)} h` : `${m} min` }))

function nearest(options: readonly number[], target: number): number {
  return options.reduce((best, o) => (Math.abs(o - target) < Math.abs(best - target) ? o : best), options[0] ?? target)
}

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

  const [minutes, setMinutes] = useState<number>(60)
  const [mood, setMood] = useState<Mood>('ok')
  const [friend, setFriend] = useState(false)
  const [swapOpen, setSwapOpen] = useState(false)
  const touchedMinutes = useRef(false)
  const missionArea = useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion()

  // Start from the person's own usual duration, unless they have already picked one.
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

  const ctx: PlanContext = { duration_limit: minutes, mood, social_available: friend }
  const busy = phase.kind === 'loading'

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
        <p className="mt-2 text-muted-foreground">Set the scene, and we will pick one thing worth leaving the screen for.</p>
      </div>

      {phase.kind !== 'going' && (
        <div className="space-y-5 rounded-2xl border bg-card/60 p-5">
          <div>
            <p className="mb-2 text-sm font-medium">How long do you have?</p>
            <ChoiceGroup
              label="Time available"
              options={MINUTE_OPTIONS}
              value={minutes}
              onChange={(v) => {
                touchedMinutes.current = true
                setMinutes(v)
              }}
              disabled={busy}
            />
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">How is your energy?</p>
            <ChoiceGroup label="Energy" options={MOOD_OPTIONS} value={mood} onChange={setMood} disabled={busy} />
          </div>
          <PreferenceChip selected={friend} onToggle={() => setFriend((f) => !f)} disabled={busy}>
            Someone is free to join me
          </PreferenceChip>
        </div>
      )}

      <p role="status" className="sr-only">
        {status}
      </p>

      <div ref={missionArea} className="scroll-mt-6 space-y-6">
      {phase.kind === 'idle' && (
        <PrimaryAction onClick={() => void plan(ctx)}>Find my mission</PrimaryAction>
      )}

      {phase.kind === 'loading' && <Skeleton />}

      {phase.kind === 'shown' && (
        <div className="space-y-3">
          <MissionCard
            title={phase.rec.title}
            reason={phase.rec.reason}
            firstStep={phase.rec.first_step}
            transitionKey={`${phase.rec.activity_id}|${phase.rec.source}`}
            busy={phase.upgrading}
            meta={<Meta rec={phase.rec} upgrading={phase.upgrading} />}
            actions={
              <>
                <PrimaryAction onClick={go}>Let's go</PrimaryAction>
                <Button variant="ghost" onClick={() => setSwapOpen((o) => !o)} aria-expanded={swapOpen}>
                  Not this one
                </Button>
              </>
            }
          />
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

      {phase.kind === 'going' && (
        <MissionCard
          title="Go. We will be here when you are back."
          reason="Put the phone away. Nothing here needs you until you have done it."
          firstStep={phase.rec.first_step}
          meta={
            <>
              <ContextPill icon={Clock}>{phase.rec.duration_min} min</ContextPill>
              <ContextPill>{phase.rec.title}</ContextPill>
            </>
          }
          actions={
            <>
              <PrimaryAction onClick={() => navigate('/feedback')}>I am back</PrimaryAction>
              <Button variant="ghost" onClick={reset}>
                Choose something else
              </Button>
            </>
          }
        />
      )}

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
          <Button className="mt-4" onClick={() => void plan(ctx)}>
            Try again
          </Button>
        </div>
      )}
      </div>
    </section>
  )
}
