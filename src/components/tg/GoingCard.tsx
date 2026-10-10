import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import type { RecommendResponse } from '@/shared/api'
import { questsFor } from '@/shared/quests'
import { Button } from '@/components/ui/button'
import { awayText } from '@/lib/away'
import { loadMission, minutesAway, setQuestTicked } from '@/lib/mission-store'
import { cn } from '@/lib/utils'
import { ContextPill } from './ContextPill'
import { MissionCard } from './MissionCard'
import { PrimaryAction } from './PrimaryAction'

type Props = {
  rec: RecommendResponse
  onBack: () => void
  onChooseAnother: () => void
}

/**
 * The screen for while the person is out. It does not ask for attention: it gives them something to look for.
 * Two side quests (the same two every time for this mission) they can tick off along the way.
 */
export function GoingCard({ rec, onBack, onChooseAnother }: Props) {
  const quests = questsFor(rec.activity_id, rec.recommendation_id)
  const [ticked, setTicked] = useState<boolean[]>(() => loadMission()?.questsTicked ?? [])
  const [away, setAway] = useState<number | null>(() => minutesAway(loadMission()))

  // Keep the elapsed time honest, including after the phone was asleep in a pocket.
  useEffect(() => {
    const update = () => setAway(minutesAway(loadMission()))
    const id = window.setInterval(update, 30_000)
    document.addEventListener('visibilitychange', update)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])

  const toggle = (i: number) => setTicked(setQuestTicked(i, !ticked[i]))
  const found = quests.filter((_, i) => ticked[i]).length
  const text = awayText(away)

  return (
    <MissionCard
      title="Go. We will be here when you are back."
      reason="Put the phone away. Nothing here needs you until you have done it."
      firstStep={rec.first_step}
      preparation={rec.preparation}
      meta={
        <>
          {text && <ContextPill>{text}</ContextPill>}
          <ContextPill>{rec.title}</ContextPill>
        </>
      }
      extra={
        <div className="mt-5">
          <p className="text-xs font-medium tracking-wide text-primary uppercase">Side quests, if you feel like it</p>
          <ul className="mt-2 space-y-2">
            {quests.map((q, i) => (
              <li key={q}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={ticked[i] === true}
                  onClick={() => toggle(i)}
                  className={cn(
                    'flex min-h-12 w-full items-center gap-3 rounded-xl border px-4 py-2.5 text-left text-sm outline-none transition-all',
                    'focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]',
                    ticked[i] ? 'border-primary/60 bg-primary/15 text-foreground' : 'border-border bg-background/50 text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'grid size-6 shrink-0 place-items-center rounded-full border transition-all',
                      ticked[i] ? 'scale-110 border-primary bg-primary text-primary-foreground' : 'border-border',
                    )}
                  >
                    {ticked[i] && <Check className="size-3.5" strokeWidth={3} />}
                  </span>
                  <span className={cn(ticked[i] && 'text-foreground')}>{q}</span>
                </button>
              </li>
            ))}
          </ul>
          {found === quests.length && <p className="mt-2 text-sm text-primary">Found them both. Nicely done.</p>}
        </div>
      }
      actions={
        <>
          <PrimaryAction onClick={onBack}>I am back</PrimaryAction>
          <Button variant="ghost" onClick={onChooseAnother}>
            Choose something else
          </Button>
        </>
      }
    />
  )
}
