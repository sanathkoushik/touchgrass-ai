import { Lightbulb, X } from 'lucide-react'
import type { LearnedResponse } from '@/shared/api'
import { Button } from '@/components/ui/button'

type Props = {
  suggestion: NonNullable<LearnedResponse['suggestion']>
  onTry: () => void
  onDismiss: () => void
  disabled?: boolean
}

/** One kind thing the assistant noticed that fits this moment. Easy to wave away, never repeated this visit once dismissed. */
export function AssistantSuggestion({ suggestion, onTry, onDismiss, disabled }: Props) {
  return (
    <aside aria-label="Something we noticed" className="flex items-start gap-3 rounded-2xl border border-primary/30 bg-primary/10 p-4">
      <Lightbulb className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-relaxed">{suggestion.text}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={onTry} disabled={disabled}>
            Yes, try it
          </Button>
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            Not now
          </Button>
        </div>
      </div>
      <button type="button" aria-label="Dismiss" onClick={onDismiss} className="rounded-md p-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        <X className="size-4" aria-hidden="true" />
      </button>
    </aside>
  )
}
