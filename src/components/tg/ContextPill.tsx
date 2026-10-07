import type { ComponentType, ReactNode } from 'react'
import { cn } from '@/lib/utils'

type Props = {
  icon?: ComponentType<{ className?: string }>
  children: ReactNode
  className?: string
}

/** Small read-only chip for context facts (time, weather, duration, social mode). */
export function ContextPill({ icon: Icon, children, className }: Props) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border bg-secondary/60 px-2.5 py-1 text-xs text-secondary-foreground',
        className,
      )}
    >
      {Icon && <Icon className="size-3.5 text-primary" />}
      {children}
    </span>
  )
}
