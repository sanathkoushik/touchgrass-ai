import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { m, useReducedMotion } from 'motion/react'
import { Sparkles } from 'lucide-react'
import type { MeadowResponse } from '@/shared/api'
import { formatMinutes, type RewardSummary } from '@/shared/meadow'
import { Button } from '@/components/ui/button'
import { getMeadow } from '@/lib/api'
import { celebrationHeadline, remainingText } from '@/lib/meadow-text'
import { AvoidPrompt } from './AvoidPrompt'
import { Meadow } from './Meadow'
import { PrimaryAction } from './PrimaryAction'

type Props = {
  outcome: 'completed' | 'partial'
  enjoyment: number | null
  reward: RewardSummary
  /** Plain sentences saying what will be done differently because of the answers just given. */
  adaptations?: string[]
  /** They said they would not repeat it: offer to stop suggesting it. */
  askToAvoid?: { activity_id: string; title: string }
  /** They wrote a note or kept a photo. */
  keptMemory?: boolean
  onNext: () => void
}

/** Counts up to `target` (instantly for people who prefer reduced motion). */
function useCountUp(target: number, ms = 1100): number {
  const reduce = useReducedMotion()
  const [value, setValue] = useState(reduce ? target : 0)
  useEffect(() => {
    if (reduce) {
      setValue(target)
      return
    }
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms)
      setValue(Math.round(target * (1 - Math.pow(1 - t, 3))))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms, reduce])
  return value
}

/**
 * The moment after a mission. It says, in real numbers, what the person just did: how much time went into the meadow,
 * how it grew, and any milestone they just earned. No scores, no comparison with anyone, nothing that can be lost.
 */
export function Celebration({ outcome, enjoyment, reward, adaptations = [], askToAvoid, keptMemory, onNext }: Props) {
  const reduce = useReducedMotion()
  const [meadow, setMeadow] = useState<MeadowResponse | null>(null)
  const added = useCountUp(reward.credited_minutes)

  // Background: the flowers and the next goal. The celebration never waits for this.
  useEffect(() => {
    const ac = new AbortController()
    getMeadow(ac.signal).then(setMeadow).catch(() => {})
    return () => ac.abort()
  }, [])

  const before = reward.total_minutes - reward.credited_minutes
  const flowers = meadow?.flowers ?? []
  const nextLeft = meadow?.next ? remainingText(meadow.next) : null
  const next = meadow?.next && nextLeft ? `${meadow.next.title}, ${nextLeft}` : null

  return (
    <section className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl border bg-card shadow-xl shadow-black/30">
        <Meadow
          minutes={reward.total_minutes}
          flowers={flowers}
          missions={reward.missions}
          garden={meadow?.garden}
          fromMinutes={before}
          fromFlowers={Math.max(0, flowers.length - 1)}
          className="aspect-[2/1] rounded-none sm:aspect-[5/2]"
        />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-background/90 via-background/55 to-transparent px-6 pt-16 pb-5">
          <p className="font-display text-5xl font-medium tracking-tight sm:text-6xl">
            +{added}
            <span className="ml-1.5 text-2xl text-muted-foreground sm:text-3xl">min</span>
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            added to your meadow · {formatMinutes(reward.total_minutes)} outside in all, from {reward.missions} mission{reward.missions === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <h1 className="font-display text-3xl font-medium tracking-tight">{celebrationHeadline(outcome, enjoyment)}</h1>
        {reward.quests_done > 0 && <p className="text-muted-foreground">You also tried the little prompt along the way.</p>}
        {keptMemory && <p className="text-muted-foreground">Kept as a memory in your meadow.</p>}
      </div>

      {reward.new_milestones.length > 0 && (
        <ul className="space-y-3" aria-label="New milestones">
          {reward.new_milestones.map((milestone, i) => (
            <m.li
              key={milestone.id}
              initial={reduce ? false : { opacity: 0, y: 12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ delay: reduce ? 0 : 0.9 + i * 0.25, type: 'spring', stiffness: 260, damping: 22 }}
              className="flex items-start gap-3 rounded-2xl border border-primary/40 bg-primary/10 p-4"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/20 text-primary" aria-hidden="true">
                <Sparkles className="size-5" />
              </span>
              <div>
                <p className="text-xs font-medium tracking-wide text-primary uppercase">New milestone</p>
                <p className="font-display text-xl font-medium">{milestone.title}</p>
                <p className="text-sm text-muted-foreground">{milestone.description}</p>
              </div>
            </m.li>
          ))}
        </ul>
      )}

      {adaptations.length > 0 && (
        <div className="space-y-2 rounded-2xl border bg-card p-4">
          <p className="text-xs font-medium tracking-wide text-primary uppercase">What changes next</p>
          <ul className="space-y-1.5 text-sm">
            {adaptations.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      {askToAvoid && <AvoidPrompt activity={askToAvoid} />}

      {next && <p className="text-sm text-muted-foreground">Next up: {next}.</p>}

      <div className="flex flex-wrap gap-3 pt-1">
        <PrimaryAction onClick={onNext}>Plan the next one</PrimaryAction>
        <Button asChild variant="ghost">
          <Link to="/history">See my meadow</Link>
        </Button>
      </div>
    </section>
  )
}
