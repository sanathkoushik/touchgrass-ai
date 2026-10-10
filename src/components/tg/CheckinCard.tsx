import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { DESIRED_OUTCOMES, MOODS, type ActivityMode, type DesiredOutcome, type Mood } from '@/shared/engine/types'
import { askPlan, COMPANY_CHOICES, type CheckinMemory, type Company } from '@/lib/checkin'
import type { SavedPlace } from '@/lib/location'
import { COMPANY_LABELS, DESIRED_OUTCOME_LABELS, DURATION_OPTIONS_FOR_PLAN, MODE_CHOICES, MOOD_LABELS } from '@/lib/vocab'
import { Button } from '@/components/ui/button'
import { ChoiceGroup } from './ChoiceGroup'
import { LocationPicker } from './LocationPicker'
import { PreferenceChip } from './PreferenceChip'

const MINUTE_OPTIONS = DURATION_OPTIONS_FOR_PLAN.map((m) => ({ value: m, label: m >= 60 ? `${m / 60 === Math.floor(m / 60) ? m / 60 : (m / 60).toFixed(1)} h` : `${m} min` }))
const MOOD_OPTIONS = MOODS.map((m) => ({ value: m, label: MOOD_LABELS[m].label, hint: MOOD_LABELS[m].hint }))
const MODE_OPTIONS = MODE_CHOICES.map((m) => ({ value: m.value, label: m.label, hint: m.hint }))
const COMPANY_OPTIONS = COMPANY_CHOICES.map((c) => ({ value: c, label: COMPANY_LABELS[c].label, hint: COMPANY_LABELS[c].hint }))
const OUTCOME_OPTIONS = DESIRED_OUTCOMES.map((o) => ({ value: o as DesiredOutcome | 'none', label: DESIRED_OUTCOME_LABELS[o].label, hint: DESIRED_OUTCOME_LABELS[o].hint })).concat([{ value: 'none', label: 'No particular goal', hint: 'Surprise me' }])

type Props = {
  minutes: number
  onMinutes: (m: number) => void
  mood: Mood
  onMood: (m: Mood) => void
  company: Company
  onCompany: (c: Company) => void
  outcome: DesiredOutcome | null
  onOutcome: (o: DesiredOutcome | null) => void
  mode: 'auto' | ActivityMode
  onMode: (m: 'auto' | ActivityMode) => void
  place: SavedPlace | null
  onPlace: (p: SavedPlace | null) => void
  /** What the check-in already remembers: decides whether the extra questions are asked in full. */
  memory: CheckinMemory
  /** The earlier plain flow: a simple "someone is free" toggle and no goal question. */
  classic?: boolean
  disabled?: boolean
}

/**
 * The daily check-in: only what changes today's decision. Time and energy are always asked. Company and what they
 * want out of it are asked in full the first time, then shrink to a one-line summary, and are skipped altogether when
 * the person has almost no time. Everything else lives under "More options".
 */
export function CheckinCard(p: Props) {
  const [expanded, setExpanded] = useState(false)
  const ask = askPlan(p.minutes, p.memory, expanded)
  const summary = `${COMPANY_LABELS[p.company].label} · ${p.outcome ? DESIRED_OUTCOME_LABELS[p.outcome].label : 'No particular goal'}`

  return (
    <div className="space-y-5 rounded-2xl border bg-card/60 p-5">
      <div>
        <p className="mb-2 text-sm font-medium">How long do you have?</p>
        <ChoiceGroup label="Time available" options={MINUTE_OPTIONS} value={p.minutes} onChange={p.onMinutes} disabled={p.disabled} />
      </div>
      <div>
        <p className="mb-2 text-sm font-medium">How is your energy?</p>
        <ChoiceGroup label="Energy" options={MOOD_OPTIONS} value={p.mood} onChange={p.onMood} disabled={p.disabled} />
      </div>

      {p.classic ? (
        <PreferenceChip selected={p.company !== 'alone'} onToggle={() => p.onCompany(p.company === 'alone' ? 'together' : 'alone')} disabled={p.disabled}>
          Someone is free to join me
        </PreferenceChip>
      ) : ask.skipExtras ? (
        <p className="text-sm text-muted-foreground">Quick one: we will keep it simple, with what we know from last time.</p>
      ) : ask.expanded ? (
        <>
          <div>
            <p className="mb-2 text-sm font-medium">Who is with you?</p>
            <ChoiceGroup label="Company" options={COMPANY_OPTIONS} value={p.company} onChange={p.onCompany} disabled={p.disabled} />
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">What would you like out of it?</p>
            <ChoiceGroup
              label="What you want out of it"
              options={OUTCOME_OPTIONS}
              value={p.outcome ?? 'none'}
              onChange={(v) => p.onOutcome(v === 'none' ? null : v)}
              disabled={p.disabled}
            />
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-background/40 px-4 py-2.5 text-sm">
          <span>
            <span className="text-muted-foreground">As last time: </span>
            {summary}
          </span>
          <Button variant="ghost" size="sm" onClick={() => setExpanded(true)}>
            Change
          </Button>
        </div>
      )}

      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
          More options
        </summary>
        <div className="mt-4 space-y-5">
          <div>
            <p className="mb-2 text-sm font-medium">How big should it be?</p>
            <ChoiceGroup label="Size of the activity" options={MODE_OPTIONS} value={p.mode} onChange={p.onMode} disabled={p.disabled} />
          </div>
          <LocationPicker place={p.place} onChange={p.onPlace} disabled={p.disabled} />
        </div>
      </details>
    </div>
  )
}
