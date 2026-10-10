import type { Family } from '@/shared/engine/types'

/**
 * Where every blade of grass and every flower of the meadow goes. Pure and deterministic: blade number 7 is in the
 * same place whether you have 30 minutes or 30 hours, so the meadow only ever GROWS, nothing jumps or reshuffles.
 */

export const VIEW = { width: 400, height: 200 } as const
export const MAX_BLADES = 360
export const SWAY_GROUPS = 6
const SEED_BLADES = 36

/** A small, fast, well-behaved seeded random number generator (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Blades for a given total of minutes outside: a few seedlings at zero, ever more as time adds up, never "full". */
export function bladeCount(minutes: number): number {
  const m = Math.max(0, Number.isFinite(minutes) ? minutes : 0)
  return Math.min(MAX_BLADES, Math.round(SEED_BLADES + (MAX_BLADES - SEED_BLADES) * (1 - Math.exp(-m / 600))))
}

export interface Blade {
  index: number
  /** 0 = far, 1 = middle, 2 = near. */
  depth: 0 | 1 | 2
  /** Which sway group it belongs to (groups sway together, so the page animates six elements, not three hundred). */
  group: number
  d: string
}

export function blade(index: number): Blade {
  const r = rng(index * 7919 + 13)
  const depth = (index % 3) as 0 | 1 | 2
  const x = 4 + r() * 392
  const baseY = 150 + depth * 16 + r() * 8
  const height = (24 + r() * 38) * (0.8 + depth * 0.2)
  const lean = (r() - 0.5) * 16
  const half = 1.1 + depth * 0.5 + r() * 0.6
  const tipX = x + lean
  const tipY = baseY - height
  const midX = x + lean * 0.35
  const midY = baseY - height * 0.55
  const f = (n: number) => Math.round(n * 10) / 10
  const d = `M${f(x - half)} ${f(baseY)} Q${f(midX - half * 0.4)} ${f(midY)} ${f(tipX)} ${f(tipY)} Q${f(midX + half * 0.4)} ${f(midY)} ${f(x + half)} ${f(baseY)}Z`
  return { index, depth, group: index % SWAY_GROUPS, d }
}

export function blades(minutes: number): Blade[] {
  return Array.from({ length: bladeCount(minutes) }, (_, i) => blade(i))
}

export interface Flower {
  index: number
  family: Family
  x: number
  /** Where the flower head sits. */
  y: number
  /** Where the stem starts. */
  baseY: number
  size: number
  petals: number
}

export function flower(index: number, family: Family): Flower {
  const r = rng(index * 104729 + 7)
  const x = 12 + r() * 376
  const baseY = 158 + r() * 26
  const stem = 22 + r() * 24
  return { index, family, x: Math.round(x * 10) / 10, baseY: Math.round(baseY * 10) / 10, y: Math.round((baseY - stem) * 10) / 10, size: 2.6 + r() * 1.6, petals: 5 + Math.floor(r() * 3) }
}

export function flowers(families: Family[]): Flower[] {
  return families.map((family, i) => flower(i, family))
}

/** Plain-words description for screen readers: the picture is decoration, the numbers are the content. */
export function meadowLabel(
  minutes: number,
  missions: number,
  garden?: { trees: number; keepsakes: number; social_tokens: number; seeds: number; lessons: number },
): string {
  const part = (count: number, one: string, many: string) => (count > 0 ? [`${count} ${count === 1 ? one : many}`] : [])
  const parts = garden
    ? [
        ...part(garden.trees, 'tree for something you have grown to enjoy', 'trees for things you have grown to enjoy'),
        ...part(garden.keepsakes, 'keepsake', 'keepsakes'),
        ...part(garden.social_tokens, 'lantern for time with others', 'lanterns for time with others'),
        ...part(garden.seeds, 'seed for an honest check-in', 'seeds for honest check-ins'),
        ...part(garden.lessons, 'star for something learned', 'stars for things learned'),
      ]
    : []
  const extra = parts.length > 0 ? ` In the garden: ${parts.join(', ')}.` : ''
  if (minutes <= 0) return `Your meadow: just a few seedlings so far. It grows with every minute you spend outside.${extra}`
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  const time = h > 0 ? `${h} hour${h === 1 ? '' : 's'}${m ? ` ${m} minutes` : ''}` : `${m} minutes`
  return `Your meadow, grown from ${time} outside across ${missions} mission${missions === 1 ? '' : 's'}.${extra}`
}

// ------------------------------------------------------------------ the memory garden
// Same promise as the grass: element N is always in the same place, so the garden only ever grows.

export const GARDEN_CAPS = { trees: 6, keepsakes: 8, lanterns: 8, sprouts: 12, stars: 8 } as const

export interface Spot {
  index: number
  x: number
  y: number
  scale: number
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** Trees stand on the far hill, spread across the width in a fixed order (never bunched at one side). */
const TREE_XS = [70, 310, 190, 20, 360, 130]
export function treeSpots(count: number): Spot[] {
  return Array.from({ length: Math.min(count, GARDEN_CAPS.trees) }, (_, i) => {
    const r = rng(i * 31337 + 5)
    return { index: i, x: TREE_XS[i]! + round1((r() - 0.5) * 16), y: round1(150 + r() * 6), scale: round1(0.95 + r() * 0.3) }
  })
}

/** Small stacks of stones in the foreground: one per memory kept. */
export function keepsakeSpots(count: number): Spot[] {
  return Array.from({ length: Math.min(count, GARDEN_CAPS.keepsakes) }, (_, i) => {
    const r = rng(i * 8191 + 11)
    return { index: i, x: round1(14 + r() * 372), y: round1(176 + r() * 12), scale: round1(0.85 + r() * 0.35) }
  })
}

/** Little lanterns on short posts: one per mission shared with someone. */
export function lanternSpots(count: number): Spot[] {
  return Array.from({ length: Math.min(count, GARDEN_CAPS.lanterns) }, (_, i) => {
    const r = rng(i * 4093 + 17)
    return { index: i, x: round1(18 + r() * 364), y: round1(166 + r() * 14), scale: round1(0.9 + r() * 0.25) }
  })
}

/** Tiny sprouts in front: one per honest check-in. */
export function sproutSpots(count: number): Spot[] {
  return Array.from({ length: Math.min(count, GARDEN_CAPS.sprouts) }, (_, i) => {
    const r = rng(i * 2749 + 23)
    return { index: i, x: round1(10 + r() * 380), y: round1(186 + r() * 10), scale: round1(0.8 + r() * 0.3) }
  })
}

/** Stars in the sky: one per lesson the person confirmed. Kept clear of the sun. */
export function starSpots(count: number): Spot[] {
  const out: Spot[] = []
  let attempt = 0
  while (out.length < Math.min(count, GARDEN_CAPS.stars)) {
    const r = rng(out.length * 1597 + attempt * 101 + 29)
    attempt += 1
    const x = 14 + r() * 372
    const y = 10 + r() * 52
    if (Math.hypot(x - 310, y - 64) < 50) continue // not on the sun
    out.push({ index: out.length, x: round1(x), y: round1(y), scale: round1(0.8 + r() * 0.5) })
    attempt = 0
  }
  return out
}
