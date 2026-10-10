import { Footprints } from 'lucide-react'
import type { NextStep, PlanPrefill } from '@/shared/next-step'
import { Button } from '@/components/ui/button'

type Props = {
  step: NextStep
  onTry: (plan: PlanPrefill) => void
}

/** After a mission that did not happen: kind words and a smaller next step, never a dead end. */
export function NextStepCard({ step, onTry }: Props) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-primary/30 bg-primary/10 p-5">
      <Footprints className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0">
        <h2 className="font-display text-xl font-medium">{step.headline}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{step.detail}</p>
        {step.action && (
          <Button className="mt-3" onClick={() => onTry(step.action!.plan)}>
            {step.action.label}
          </Button>
        )}
      </div>
    </div>
  )
}
