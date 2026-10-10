import { Link } from 'react-router-dom'
import { m, useReducedMotion } from 'motion/react'
import { Sparkles, Sprout } from 'lucide-react'
import type { FeedbackResponse } from '@/shared/api'
import type { PlanPrefill } from '@/shared/next-step'
import { Button } from '@/components/ui/button'
import { NextStepCard } from './NextStepCard'
import { PrimaryAction } from './PrimaryAction'

type Props = {
  outcome: 'skipped' | 'changed'
  recognition: NonNullable<FeedbackResponse['recognition']>
  nextStep?: FeedbackResponse['next_step']
  onTry: (plan: PlanPrefill) => void
  onNext: () => void
}

/**
 * After a mission that did not happen. The point: telling the truth is never the worse choice. It earns a seed in the
 * meadow (no minutes, nothing taken away) and always leads to a smaller next step.
 */
export function RecognitionCard({ outcome, recognition, nextStep, onTry, onNext }: Props) {
  const reduce = useReducedMotion()
  return (
    <section className="space-y-6">
      <div className="flex items-start gap-4 rounded-2xl border bg-card p-6">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary/15 text-primary" aria-hidden="true">
          <Sprout className="size-6" />
        </span>
        <div>
          <h1 className="font-display text-3xl font-medium tracking-tight">{outcome === 'skipped' ? 'Thank you for telling us.' : 'Good to know what you did instead.'}</h1>
          <p className="mt-2 text-muted-foreground">
            A seed has been planted in your meadow for being honest. You now have {recognition.seeds} {recognition.seeds === 1 ? 'seed' : 'seeds'}. Your meadow stays exactly as it was, and nothing is ever taken away.
          </p>
        </div>
      </div>

      {recognition.new_milestones.length > 0 && (
        <ul className="space-y-3" aria-label="New milestones">
          {recognition.new_milestones.map((milestone, i) => (
            <m.li
              key={milestone.id}
              initial={reduce ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: reduce ? 0 : 0.3 + i * 0.2 }}
              className="flex items-start gap-3 rounded-2xl border border-primary/40 bg-primary/10 p-4"
            >
              <Sparkles className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <p className="text-xs font-medium tracking-wide text-primary uppercase">New milestone</p>
                <p className="font-display text-xl font-medium">{milestone.title}</p>
                <p className="text-sm text-muted-foreground">{milestone.description}</p>
              </div>
            </m.li>
          ))}
        </ul>
      )}

      {nextStep && <NextStepCard step={nextStep} onTry={onTry} />}

      <div className="flex flex-wrap gap-3">
        <PrimaryAction onClick={onNext}>Plan the next one</PrimaryAction>
        <Button asChild variant="ghost">
          <Link to="/history">See my meadow</Link>
        </Button>
      </div>
    </section>
  )
}
