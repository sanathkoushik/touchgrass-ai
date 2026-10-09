import type { ReactNode } from 'react'
import { m, useReducedMotion } from 'motion/react'
import { PixelCanvas } from '@/components/ui/pixel-canvas'
import { Spotlight } from '@/components/ui/spotlight'
import { cn } from '@/lib/utils'

type Props = {
  title: string
  reason?: string
  firstStep?: string
  /** What to have ready (may be empty). */
  preparation?: string[]
  /** Pills row: duration, social mode, weather... */
  meta?: ReactNode
  /** Primary action and fallback controls */
  actions?: ReactNode
  /** When this changes, the text fades in again (e.g. when the AI upgrades the wording). */
  transitionKey?: string
  /** True while something about this card is still being worked on. */
  busy?: boolean
  className?: string
}

/**
 * The dominant element on Home. Content is plain HTML/CSS; the spotlight is decorative
 * (aria-hidden, pointer-events-none) so the mission stays readable if the effect fails.
 */
export function MissionCard({ title, reason, firstStep, preparation, meta, actions, transitionKey, busy, className }: Props) {
  const reduceMotion = useReducedMotion()
  return (
    <article
      aria-busy={busy || undefined}
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
      {/* Fades in again whenever transitionKey changes. The old text is replaced at once: no layout jump, no blank state. */}
      <m.div
        key={transitionKey}
        initial={reduceMotion || transitionKey === undefined ? false : { opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
      >
        <h2 className="font-display text-2xl font-medium tracking-tight text-balance">{title}</h2>
        {reason && <p className="mt-2 text-muted-foreground">{reason}</p>}
        {firstStep && (
          <div className="mt-5 rounded-xl border bg-background/50 p-4 backdrop-blur-sm">
            <p className="text-xs font-medium tracking-wide text-primary uppercase">First step</p>
            <p className="mt-1">{firstStep}</p>
          </div>
        )}
        {preparation && preparation.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Have ready</p>
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {preparation.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        )}
      </m.div>
      {actions && <div className="mt-6 flex flex-wrap items-center gap-3">{actions}</div>}
    </article>
  )
}
