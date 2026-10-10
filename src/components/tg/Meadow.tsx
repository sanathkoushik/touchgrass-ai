import { useId, useMemo } from 'react'
import type { Family } from '@/shared/engine/types'
import type { Garden } from '@/shared/meadow'
import { SWAY_GROUPS, VIEW, bladeCount, blades, flowers, keepsakeSpots, lanternSpots, meadowLabel, sproutSpots, starSpots, treeSpots } from '@/lib/meadow-layout'
import { cn } from '@/lib/utils'

type Props = {
  /** Total minutes outside: how much grass there is. */
  minutes: number
  /** One flower per mission, by kind. */
  flowers: Family[]
  missions: number
  /** What the garden holds besides grass and flowers (trees, keepsakes, lanterns, seeds, stars). */
  garden?: Garden
  /** Start growing from here (the celebration): only blades and flowers beyond this animate in. */
  fromMinutes?: number
  fromFlowers?: number
  className?: string
}

// Flower colours by kind. These are illustration colours (like a photograph), not UI colours, so they are not theme tokens.
const PETAL: Record<Family, string> = {
  movement: 'oklch(0.86 0.15 90)',
  exploration: 'oklch(0.76 0.12 300)',
  social_skill: 'oklch(0.78 0.14 25)',
}

/**
 * The meadow: a quiet picture that grows with the minutes the person has really spent outside. Decorative (the numbers
 * beside it are the content), and it only uses CSS transforms, so it stays smooth. It never wilts: nothing here shrinks.
 */
export function Meadow({ minutes, flowers: families, missions, garden, fromMinutes, fromFlowers, className }: Props) {
  const uid = useId().replace(/:/g, '')
  const all = useMemo(() => blades(minutes), [minutes])
  const heads = useMemo(() => flowers(families), [families])
  const growFrom = fromMinutes === undefined ? Infinity : bladeCount(fromMinutes)
  const flowerGrowFrom = fromFlowers === undefined ? Infinity : fromFlowers

  const layers = [0, 1, 2].map((depth) => all.filter((b) => b.depth === depth))
  const trees = useMemo(() => treeSpots(garden?.trees.length ?? 0), [garden?.trees.length])
  const stones = useMemo(() => keepsakeSpots(garden?.keepsakes ?? 0), [garden?.keepsakes])
  const lanterns = useMemo(() => lanternSpots(garden?.social_tokens ?? 0), [garden?.social_tokens])
  const sprouts = useMemo(() => sproutSpots(garden?.seeds ?? 0), [garden?.seeds])
  const stars = useMemo(() => starSpots(garden?.lessons ?? 0), [garden?.lessons])

  return (
    <svg
      role="img"
      aria-label={meadowLabel(minutes, missions, garden ? { trees: garden.trees.length, keepsakes: garden.keepsakes, social_tokens: garden.social_tokens, seeds: garden.seeds, lessons: garden.lessons } : undefined)}
      viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
      preserveAspectRatio="xMidYMax slice"
      className={cn('block w-full rounded-2xl', className)}
    >
      <defs>
        <linearGradient id={`${uid}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="oklch(0.2 0.03 200)" />
          <stop offset="0.7" stopColor="oklch(0.34 0.06 150)" />
          <stop offset="1" stopColor="oklch(0.46 0.1 120)" />
        </linearGradient>
        <radialGradient id={`${uid}-sun`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="oklch(0.95 0.1 95)" stopOpacity="0.95" />
          <stop offset="0.35" stopColor="oklch(0.9 0.12 90)" stopOpacity="0.35" />
          <stop offset="1" stopColor="oklch(0.9 0.12 90)" stopOpacity="0" />
        </radialGradient>
        {[0, 1, 2].map((d) => (
          <linearGradient key={d} id={`${uid}-blade${d}`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" style={{ stopColor: 'var(--primary)', stopOpacity: 0.35 + d * 0.15 }} />
            <stop offset="1" style={{ stopColor: 'var(--primary)', stopOpacity: 0.7 + d * 0.15 }} />
          </linearGradient>
        ))}
      </defs>

      <rect width={VIEW.width} height={VIEW.height} fill={`url(#${uid}-sky)`} />
      <circle cx="310" cy="64" r="64" fill={`url(#${uid}-sun)`} />

      {/* a star for each thing the person confirmed we learned about them */}
      {stars.map((st) => (
        <path key={`star${st.index}`} className="meadow-twinkle" style={{ animationDelay: `${-st.index * 0.7}s` }} d={`M${st.x} ${st.y - 3 * st.scale} L${st.x + 0.9 * st.scale} ${st.y - 0.9 * st.scale} L${st.x + 3 * st.scale} ${st.y} L${st.x + 0.9 * st.scale} ${st.y + 0.9 * st.scale} L${st.x} ${st.y + 3 * st.scale} L${st.x - 0.9 * st.scale} ${st.y + 0.9 * st.scale} L${st.x - 3 * st.scale} ${st.y} L${st.x - 0.9 * st.scale} ${st.y - 0.9 * st.scale}Z`} fill="oklch(0.97 0.06 95)" />
      ))}

      {/* distant hills */}
      <path d="M0 132 Q70 104 150 126 T300 118 T400 130 V200 H0Z" fill="oklch(0.3 0.06 160)" />
      <path d="M0 148 Q90 124 190 144 T400 140 V200 H0Z" fill="oklch(0.26 0.06 150)" />
      <rect y="156" width={VIEW.width} height="44" fill="oklch(0.2 0.05 150)" />

      {/* a tree for each thing they have grown to enjoy */}
      {trees.map((t) => (
        <g key={`tree${t.index}`} className="meadow-sway" style={{ animationDelay: `${-t.index * 1.3}s`, animationDuration: '9s' }}>
          <rect x={t.x - 1.6 * t.scale} y={t.y - 26 * t.scale} width={3.2 * t.scale} height={26 * t.scale} rx="1" fill="oklch(0.38 0.05 60)" />
          <circle cx={t.x} cy={t.y - 33 * t.scale} r={11 * t.scale} fill="var(--primary)" fillOpacity="0.55" />
          <circle cx={t.x - 8 * t.scale} cy={t.y - 26 * t.scale} r={8.5 * t.scale} fill="var(--primary)" fillOpacity="0.7" />
          <circle cx={t.x + 8 * t.scale} cy={t.y - 27 * t.scale} r={8 * t.scale} fill="var(--primary)" fillOpacity="0.62" />
          <circle cx={t.x - 2 * t.scale} cy={t.y - 36 * t.scale} r={4.5 * t.scale} fill="oklch(0.9 0.12 130)" fillOpacity="0.28" />
        </g>
      ))}

      {layers.map((layer, depth) => (
        <g key={depth}>
          {Array.from({ length: SWAY_GROUPS }, (_, g) => (
            <g key={g} className="meadow-sway" style={{ animationDelay: `${-(g * 0.9 + depth * 0.6)}s`, animationDuration: `${5 + g * 0.7}s` }}>
              {layer
                .filter((b) => b.group === g)
                .map((b) => (
                  <path
                    key={b.index}
                    d={b.d}
                    fill={`url(#${uid}-blade${depth})`}
                    className={b.index >= growFrom ? 'meadow-grow' : undefined}
                    style={b.index >= growFrom ? { animationDelay: `${Math.min((b.index - growFrom) * 28, 1400)}ms` } : undefined}
                  />
                ))}
            </g>
          ))}
        </g>
      ))}

      {/* the front of the garden: a seed for each honest check-in, a stack of stones for each memory kept, a lantern for each time shared */}
      {sprouts.map((s) => (
        <g key={`sprout${s.index}`} transform={`translate(${s.x} ${s.y}) scale(${s.scale})`}>
          <path d="M0 0 L0 -5" stroke="var(--primary)" strokeWidth="1" strokeLinecap="round" />
          <ellipse cx="-2.2" cy="-5.5" rx="2.4" ry="1.2" transform="rotate(-25 -2.2 -5.5)" fill="var(--primary)" />
          <ellipse cx="2.2" cy="-6" rx="2.4" ry="1.2" transform="rotate(25 2.2 -6)" fill="var(--primary)" />
        </g>
      ))}
      {stones.map((s) => (
        <g key={`stone${s.index}`} transform={`translate(${s.x} ${s.y}) scale(${s.scale})`}>
          <ellipse cx="0" cy="-1.6" rx="5.4" ry="2.2" fill="oklch(0.5 0.02 90)" />
          <ellipse cx="0.4" cy="-4.6" rx="3.9" ry="1.9" fill="oklch(0.58 0.02 90)" />
          <ellipse cx="-0.2" cy="-7" rx="2.5" ry="1.5" fill="oklch(0.66 0.02 90)" />
        </g>
      ))}
      {lanterns.map((l) => (
        <g key={`lantern${l.index}`} transform={`translate(${l.x} ${l.y}) scale(${l.scale})`}>
          <path d="M0 0 L0 -14" stroke="oklch(0.4 0.04 60)" strokeWidth="1.1" strokeLinecap="round" />
          <circle cx="0" cy="-16" r="7" fill="oklch(0.9 0.14 85)" fillOpacity="0.22" />
          <circle cx="0" cy="-16" r="2.6" fill="oklch(0.92 0.14 85)" />
        </g>
      ))}

      {heads.map((f) => {
        const isNew = f.index >= flowerGrowFrom
        return (
          <g key={f.index} className={cn('meadow-sway', isNew && 'meadow-grow')} style={isNew ? { animationDelay: `${(f.index - flowerGrowFrom) * 220 + 400}ms` } : { animationDelay: `${-(f.index % 7)}s` }}>
            <path d={`M${f.x} ${f.baseY} Q${f.x + 1.5} ${(f.baseY + f.y) / 2} ${f.x} ${f.y}`} stroke="var(--primary)" strokeOpacity="0.8" strokeWidth="1" fill="none" />
            {Array.from({ length: f.petals }, (_, p) => {
              const a = (p / f.petals) * Math.PI * 2
              return <circle key={p} cx={f.x + Math.cos(a) * f.size} cy={f.y + Math.sin(a) * f.size} r={f.size * 0.62} fill={PETAL[f.family]} />
            })}
            <circle cx={f.x} cy={f.y} r={f.size * 0.45} fill="oklch(0.9 0.14 85)" />
          </g>
        )
      })}
    </svg>
  )
}
