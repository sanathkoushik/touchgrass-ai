import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import type { RecommendResponse } from '@/shared/api'
import type { Companion } from '@/shared/engine/types'
import { questsFor } from '@/shared/quests'
import { Button } from '@/components/ui/button'
import { awayText } from '@/lib/away'
import { loadMission, minutesAway, setQuestTicked } from '@/lib/mission-store'
import { cn } from '@/lib/utils'
import { StepsList } from './CompanionPanel'
import { ContextPill } from './ContextPill'
import { MissionCard } from './MissionCard'
import { PrimaryAction } from './PrimaryAction'

type Props = {
  rec: RecommendResponse
  onBack: () => void
  onChooseAnother: () => void
  /** The earlier plain flow: no small steps, no two-minute framing. */
  classic?: boolean
}

/** A mission saved in this browser before the companion existed has no companion; the screen must cope with that. */
const companionOf = (rec: RecommendResponse): Companion | undefined => (rec as Partial<RecommendResponse>).companion

/**
 * The screen for while the person is out. It does not ask for attention: it offers ONE optional thing to notice (about
 * this kind of activity), the mission in small steps, and, if they chose "just two minutes", a gentle way to begin.
 * Nothing here needs the app to stay open or the phone to be checked.
 */
export function GoingCard({ rec, onBack, onChooseAnother, classic = false }: Props) {
  const [prompt] = questsFor(rec.activity_id, rec.recommendation_id)
  const companion = classic ? undefined : companionOf(rec)
  const [mission] = useState(() => loadMission())
  const tiny = mission?.tiny === true && !!companion
  const [ticked, setTicked] = useState<boolean[]>(() => mission?.questsTicked ?? [])
  const [away, setAway] = useState<number | null>(() => minutesAway(loadMission()))
  const [keepGoing, setKeepGoing] = useState(false)

  // Keep the elapsed time honest, including after the phone was asleep in a pocket.
  useEffect(() => {
    const update = () => setAway(minutesAway(loadMission()))
    const id = window.setInterval(update, 15_000)
    document.addEventListener('visibilitychange', update)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])

  const tryIt = ticked[0] === true
  const toggle = () => setTicked(setQuestTicked(0, !tryIt))
  const text = awayText(away)
  const twoMinutesDone = (away ?? 0) >= 2

  return (
    <MissionCard
      title={tiny && !keepGoing ? (twoMinutesDone ? 'You have done the hardest part.' : 'Two minutes. That is all you need to do right now.') : 'Go. We will be here when you are back.'}
      reason={
        tiny && !keepGoing
          ? twoMinutesDone
            ? 'Starting is the part that counts. Keep going if you feel like it, or finish here. Either one is a real mission.'
            : companion!.tiny_start.text
          : 'Put the phone away. Nothing here needs you until you have done it.'
      }
      firstStep={rec.first_step}
      preparation={rec.preparation}
      meta={
        <>
          {text && <ContextPill>{text}</ContextPill>}
          <ContextPill>{rec.title}</ContextPill>
        </>
      }
      extra={
        <div className="mt-5 space-y-5">
          {companion && companion.steps.length > 1 && (
            <details className="group">
              <summary className="cursor-pointer list-none text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                Your small steps
              </summary>
              <div className="mt-3">
                <StepsList steps={companion.steps} />
              </div>
            </details>
          )}
          <div>
            <p className="text-xs font-medium tracking-wide text-primary uppercase">One thing to notice, if you feel like it</p>
            <button
              type="button"
              role="checkbox"
              aria-checked={tryIt}
              onClick={toggle}
              className={cn(
                'mt-2 flex min-h-12 w-full items-center gap-3 rounded-xl border px-4 py-2.5 text-left text-sm outline-none transition-all',
                'focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]',
                tryIt ? 'border-primary/60 bg-primary/15 text-foreground' : 'border-border bg-background/50 text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <span aria-hidden="true" className={cn('grid size-6 shrink-0 place-items-center rounded-full border transition-all', tryIt ? 'scale-110 border-primary bg-primary text-primary-foreground' : 'border-border')}>
                {tryIt && <Check className="size-3.5" strokeWidth={3} />}
              </span>
              <span className={cn(tryIt && 'text-foreground')}>{prompt}</span>
            </button>
            {tryIt && <p className="mt-2 text-sm text-primary">Nicely noticed.</p>}
          </div>
        </div>
      }
      actions={
        tiny && !keepGoing && twoMinutesDone ? (
          <>
            <PrimaryAction onClick={() => setKeepGoing(true)}>Keep going</PrimaryAction>
            <Button variant="outline" onClick={onBack}>
              I am done for now
            </Button>
            <Button variant="ghost" onClick={onChooseAnother}>
              Choose something else
            </Button>
          </>
        ) : (
          <>
            <PrimaryAction onClick={onBack}>I am back</PrimaryAction>
            <Button variant="ghost" onClick={onChooseAnother}>
              Choose something else
            </Button>
          </>
        )
      }
    />
  )
}
