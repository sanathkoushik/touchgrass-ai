import { describe, expect, it } from 'vitest'
import { MAX_BLADES, SWAY_GROUPS, VIEW, blade, bladeCount, blades, flower, flowers, meadowLabel } from './meadow-layout'

describe('bladeCount: it only grows', () => {
  it('starts with a few seedlings, never an empty picture', () => {
    expect(bladeCount(0)).toBeGreaterThan(5)
    expect(bladeCount(-50)).toBe(bladeCount(0))
    expect(bladeCount(Number.NaN)).toBe(bladeCount(0))
    expect(bladeCount(Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(MAX_BLADES)
  })

  it('never decreases as minutes increase, and never exceeds the cap', () => {
    let last = -1
    for (let m = 0; m <= 20_000; m += 7) {
      const c = bladeCount(m)
      expect(c).toBeGreaterThanOrEqual(last)
      expect(c).toBeLessThanOrEqual(MAX_BLADES)
      last = c
    }
  })

  it('keeps visibly growing for a long time (a day outside is not "full")', () => {
    expect(bladeCount(60)).toBeGreaterThan(bladeCount(0) + 10)
    expect(bladeCount(1440)).toBeLessThan(MAX_BLADES)
    expect(bladeCount(1440)).toBeGreaterThan(bladeCount(600))
  })

  it('rewards the first minutes most (early progress is felt)', () => {
    expect(bladeCount(60) - bladeCount(0)).toBeGreaterThan(bladeCount(1100) - bladeCount(1040))
    expect(bladeCount(0)).toBeGreaterThanOrEqual(30) // a first mission already plants a real meadow, not a patch
  })
})

describe('layout is deterministic and stable', () => {
  it('gives the same blade for the same index, always', () => {
    for (const i of [0, 1, 7, 99, 359]) expect(blade(i)).toEqual(blade(i))
  })

  it('never moves existing blades when more are added (prefix-stable)', () => {
    const small = blades(30)
    const large = blades(900)
    expect(large.length).toBeGreaterThan(small.length)
    expect(large.slice(0, small.length)).toEqual(small)
  })

  it('keeps every blade inside the picture, in a valid group and depth', () => {
    for (const b of blades(100_000)) {
      expect(b.group).toBeGreaterThanOrEqual(0)
      expect(b.group).toBeLessThan(SWAY_GROUPS)
      expect([0, 1, 2]).toContain(b.depth)
      expect(b.d).toMatch(/^M[-\d. ]+Q[-\d. ]+Q[-\d. ]+Z$/)
      const nums = (b.d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
      const xs = nums.filter((_, i) => i % 2 === 0)
      const ys = nums.filter((_, i) => i % 2 === 1)
      for (const x of xs) {
        expect(x).toBeGreaterThanOrEqual(-12)
        expect(x).toBeLessThanOrEqual(VIEW.width + 12)
      }
      for (const y of ys) {
        expect(y).toBeGreaterThan(40)
        expect(y).toBeLessThanOrEqual(VIEW.height)
      }
    }
  })

  it('spreads blades across all three depths and all sway groups (no lopsided meadow)', () => {
    const all = blades(2000)
    for (const d of [0, 1, 2]) expect(all.filter((b) => b.depth === d).length).toBeGreaterThan(50)
    for (let g = 0; g < SWAY_GROUPS; g++) expect(all.filter((b) => b.group === g).length).toBeGreaterThan(30)
  })
})

describe('flowers', () => {
  it('are stable by position and keep their kind', () => {
    const a = flowers(['movement', 'exploration', 'social_skill'])
    const b = flowers(['movement', 'exploration', 'social_skill', 'movement'])
    expect(b.slice(0, 3)).toEqual(a)
    expect(a.map((f) => f.family)).toEqual(['movement', 'exploration', 'social_skill'])
  })

  it('sit inside the picture, with the head above the stem', () => {
    for (let i = 0; i < 100; i++) {
      const f = flower(i, 'movement')
      expect(f.x).toBeGreaterThan(0)
      expect(f.x).toBeLessThan(VIEW.width)
      expect(f.y).toBeLessThan(f.baseY)
      expect(f.baseY).toBeLessThanOrEqual(VIEW.height)
      expect(f.petals).toBeGreaterThanOrEqual(5)
    }
  })
})

describe('meadowLabel', () => {
  it('describes the meadow in plain words for screen readers', () => {
    expect(meadowLabel(0, 0)).toMatch(/seedlings/i)
    expect(meadowLabel(45, 1)).toBe('Your meadow, grown from 45 minutes outside across 1 mission.')
    expect(meadowLabel(80, 3)).toBe('Your meadow, grown from 1 hour 20 minutes outside across 3 missions.')
    expect(meadowLabel(120, 2)).toBe('Your meadow, grown from 2 hours outside across 2 missions.')
  })
})

import { GARDEN_CAPS, keepsakeSpots, lanternSpots, sproutSpots, starSpots, treeSpots } from './meadow-layout'

describe('the memory garden layout', () => {
  const makers = { trees: treeSpots, keepsakes: keepsakeSpots, lanterns: lanternSpots, sprouts: sproutSpots, stars: starSpots }

  it('only ever grows: spot N never moves when more are added', () => {
    for (const [name, make] of Object.entries(makers)) {
      const few = make(2)
      const many = make(8)
      expect(many.slice(0, few.length), name).toEqual(few)
    }
  })

  it('is capped, and empty for zero or negative', () => {
    for (const [name, make] of Object.entries(makers)) {
      expect(make(0), name).toEqual([])
      expect(make(-3), name).toEqual([])
      expect(make(1000).length, name).toBe(GARDEN_CAPS[name as keyof typeof GARDEN_CAPS])
    }
  })

  it('keeps every spot inside the picture, in its own band', () => {
    for (const s of treeSpots(99)) {
      expect(s.x).toBeGreaterThan(0)
      expect(s.x).toBeLessThan(VIEW.width)
      expect(s.y).toBeGreaterThanOrEqual(150)
      expect(s.y).toBeLessThanOrEqual(156)
    }
    for (const make of [keepsakeSpots, lanternSpots, sproutSpots]) {
      for (const s of make(99)) {
        expect(s.x).toBeGreaterThan(0)
        expect(s.x).toBeLessThan(VIEW.width)
        expect(s.y).toBeGreaterThan(160)
        expect(s.y).toBeLessThanOrEqual(VIEW.height)
      }
    }
  })

  it('keeps stars in the sky and clear of the sun', () => {
    for (const s of starSpots(99)) {
      expect(s.y).toBeLessThan(70)
      expect(Math.hypot(s.x - 310, s.y - 64)).toBeGreaterThanOrEqual(50)
    }
    expect(new Set(starSpots(8).map((s) => `${s.x},${s.y}`)).size).toBe(8)
  })

  it('spreads trees across the width instead of bunching them', () => {
    const xs = treeSpots(6).map((s) => s.x)
    expect(Math.min(...xs)).toBeLessThan(60)
    expect(Math.max(...xs)).toBeGreaterThan(330)
  })

  it('is deterministic', () => {
    for (const make of Object.values(makers)) expect(make(5)).toEqual(make(5))
  })

  it('describes the garden for screen readers, only what is there', () => {
    expect(meadowLabel(80, 3, { trees: 0, keepsakes: 0, social_tokens: 0, seeds: 0, lessons: 0 })).toBe('Your meadow, grown from 1 hour 20 minutes outside across 3 missions.')
    expect(meadowLabel(45, 1, { trees: 1, keepsakes: 2, social_tokens: 0, seeds: 3, lessons: 1 })).toBe(
      'Your meadow, grown from 45 minutes outside across 1 mission. In the garden: 1 tree for something you have grown to enjoy, 2 keepsakes, 3 seeds for honest check-ins, 1 star for something learned.',
    )
    expect(meadowLabel(0, 0, { trees: 0, keepsakes: 0, social_tokens: 0, seeds: 1, lessons: 0 })).toContain('1 seed for an honest check-in')
  })
})
