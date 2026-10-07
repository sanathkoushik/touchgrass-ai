import type { ReactNode } from 'react'
import { PixelCanvas } from '@/components/ui/pixel-canvas'
import { Spotlight } from '@/components/ui/spotlight'
import { cn } from '@/lib/utils'

type Props = {
  title: string
  reason?: string
  firstStep?: string
  /** Pills row: duration, social mode, weather... */
  meta?: ReactNode
  /** Primary action and fallback controls */
  actions?: ReactNode
  className?: string
}

/**
 * The dominant element on Home. Content is plain HTML/CSS; the spotlight is decorative
 * (aria-hidden, pointer-events-none) so the mission stays readable if the effect fails.
 */
export function MissionCard({ title, reason, firstStep, meta, actions, className }: Props) {
  return (
    <article
      className={cn(
        'relative isolate overflow-hidden rounded-2xl border bg-card p-6 shadow-xl shadow-black/30',
        'before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:bg-[radial-gradient(60%_50%_at_50%_0%,color-mix(in_oklch,var(--primary)_10%,transparent),transparent)]',
        className,
      )}
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <Spotlight className="-top-40 left-0 md:-top-20 md:left-40" fill="oklch(0.85 0.19 138)" />
      </div>
      {/* Direct child of the card so trackParent listens to the whole card; decorative only. */}
      <PixelCanvas
        aria-hidden="true"
        trackParent
        variant="trail"
        gap={9}
        speed={0.025}
        className="pointer-events-none absolute inset-0 -z-10 opacity-50"
      />
      {meta && <div className="mb-4 flex flex-wrap gap-2">{meta}</div>}
      <h2 className="text-2xl font-semibold tracking-tight text-balance">{title}</h2>
      {reason && <p className="mt-2 text-muted-foreground">{reason}</p>}
      {firstStep && (
        <div className="mt-5 rounded-xl border bg-background/50 p-4 backdrop-blur-sm">
          <p className="text-xs font-medium tracking-wide text-primary uppercase">First step</p>
          <p className="mt-1">{firstStep}</p>
        </div>
      )}
      {actions && <div className="mt-6 flex flex-wrap items-center gap-3">{actions}</div>}
    </article>
  )
}
