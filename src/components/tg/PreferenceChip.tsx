import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type Props = {
  selected: boolean
  onToggle: () => void
  children: ReactNode
  disabled?: boolean
}

/** Toggleable chip for onboarding choices. Keyboard + screen-reader friendly via aria-pressed. */
export function PreferenceChip({ selected, onToggle, children, disabled }: Props) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        'rounded-full border px-4 py-2 text-sm transition-all outline-none',
        'focus-visible:ring-2 focus-visible:ring-ring active:scale-95 disabled:opacity-50',
        selected
          ? 'border-primary/60 bg-primary/15 text-foreground shadow-[0_0_0_1px_var(--primary)_inset]'
          : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}
