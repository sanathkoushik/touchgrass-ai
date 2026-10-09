import type { ComponentType, ReactNode } from 'react'
import { m, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/utils'

type Props = {
  icon?: ComponentType<{ className?: string }>
  selected?: boolean
  onClick: () => void
  children: ReactNode
  disabled?: boolean
}

/** One-tap outcome button (completed / partial / skipped). Spring press feedback, reduced-motion safe. */
export function FeedbackButton({ icon: Icon, selected, onClick, children, disabled }: Props) {
  const reduce = useReducedMotion()
  return (
    <m.button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      whileTap={reduce ? undefined : { scale: 0.94 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      className={cn(
        'flex flex-1 flex-col items-center gap-1.5 rounded-xl border px-4 py-3 text-sm outline-none',
        'focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
        selected
          ? 'border-primary/60 bg-primary/15 text-foreground'
          : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      {Icon && <Icon className="size-5" />}
      {children}
    </m.button>
  )
}
