import { ChevronDown } from 'lucide-react'
import type { Companion } from '@/shared/engine/types'

/** The mission broken into small steps, each with its minutes. Used before starting and while out. */
export function StepsList({ steps }: { steps: Companion['steps'] }) {
  return (
    <ol className="space-y-2">
      {steps.map((s, i) => (
        <li key={`${i}-${s.title}`} className="flex items-start gap-3">
          <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border bg-background/60 text-xs tabular-nums text-muted-foreground" aria-hidden="true">
            {i + 1}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {s.title} <span className="font-normal text-muted-foreground">· {s.minutes} min</span>
            </p>
            <p className="text-sm text-muted-foreground">{s.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}

type Props = {
  companion: Companion
}

/**
 * What the assistant says before the person starts: a short note that reflects what they told us, the mission in small
 * steps (tucked away until wanted, so the card stays calm), and a kind way out if going outside is not possible today.
 */
export function CompanionNote({ companion }: Props) {
  return (
    <div className="mt-3 space-y-3">
      <p className="text-sm leading-relaxed">{companion.note}</p>
      {companion.steps.length > 1 && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
            See it in small steps
          </summary>
          <div className="mt-3">
            <StepsList steps={companion.steps} />
          </div>
        </details>
      )}
    </div>
  )
}

export function CompanionAlternative({ companion }: Props) {
  if (!companion.alternative) return null
  return <p className="px-1 text-sm text-muted-foreground">{companion.alternative}</p>
}
