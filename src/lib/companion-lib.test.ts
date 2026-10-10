import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QUICK_MINUTES, askPlan, loadCheckin, saveCheckin, socialAvailable } from './checkin'
import { queueNextPlan, takeNextPlan } from './next-plan'
import { MAX_SIDE, fitWithin, forgetAllPhotos, forgetPhoto, keepPhoto, loadPhotoUrl } from './photos'

function fakeStorage() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', fakeStorage())
  vi.stubGlobal('sessionStorage', fakeStorage())
})
afterEach(() => vi.unstubAllGlobals())

describe('the check-in remembers what it already knows', () => {
  it('round-trips the last answers, including an explicit "no preference"', () => {
    expect(loadCheckin()).toEqual({})
    saveCheckin({ company: 'alone', outcome: 'clear_head', mood: 'low' })
    expect(loadCheckin()).toEqual({ company: 'alone', outcome: 'clear_head', mood: 'low' })
    saveCheckin({ company: 'either', outcome: null })
    expect(loadCheckin()).toEqual({ company: 'either', outcome: null })
  })

  it('drops anything corrupt or unexpected instead of trusting it', () => {
    localStorage.setItem('tg_checkin', 'not json')
    expect(loadCheckin()).toEqual({})
    localStorage.setItem('tg_checkin', JSON.stringify({ company: 'crowd', outcome: 'win', mood: 'ecstatic', extra: 1 }))
    expect(loadCheckin()).toEqual({})
    vi.stubGlobal('localStorage', undefined)
    expect(loadCheckin()).toEqual({})
    expect(() => saveCheckin({ company: 'alone' })).not.toThrow()
  })

  it('maps company to whether someone is free', () => {
    expect(socialAvailable('alone')).toBe(false)
    expect(socialAvailable('together')).toBe(true)
    expect(socialAvailable('either')).toBe(true)
  })
})

describe('adaptive asking: only what is useful, and never when the person is in a hurry', () => {
  const known = { company: 'alone' as const, outcome: null }

  it('asks in full when nothing is remembered', () => {
    expect(askPlan(30, {}, false)).toEqual({ expanded: true, skipExtras: false })
    expect(askPlan(30, { company: 'alone' }, false)).toEqual({ expanded: true, skipExtras: false }) // only half is known
  })

  it('shrinks to a one-line summary when both answers are remembered', () => {
    expect(askPlan(30, known, false)).toEqual({ expanded: false, skipExtras: false })
  })

  it('lets the person open the full questions any time', () => {
    expect(askPlan(30, known, true)).toEqual({ expanded: true, skipExtras: false })
    expect(askPlan(QUICK_MINUTES, known, true)).toEqual({ expanded: true, skipExtras: false })
  })

  it('asks nothing extra with almost no time, even if nothing is remembered', () => {
    expect(askPlan(QUICK_MINUTES, {}, false)).toEqual({ expanded: false, skipExtras: true })
    expect(askPlan(5, known, false).skipExtras).toBe(true)
    expect(askPlan(6, {}, false).skipExtras).toBe(false)
  })
})

describe('"try this" hand-off', () => {
  it('is read exactly once', () => {
    queueNextPlan({ duration_limit: 5, mode: 'minimum', mood: 'low' })
    expect(takeNextPlan()).toEqual({ duration_limit: 5, mode: 'minimum', mood: 'low' })
    expect(takeNextPlan()).toBeNull()
  })

  it('keeps an explicit "no outcome" and the real outcomes', () => {
    queueNextPlan({ duration_limit: 30, desired_outcome: null, social_available: false })
    expect(takeNextPlan()).toEqual({ duration_limit: 30, desired_outcome: null, social_available: false })
    queueNextPlan({ duration_limit: 30, desired_outcome: 'break_routine' })
    expect(takeNextPlan()).toEqual({ duration_limit: 30, desired_outcome: 'break_routine' })
  })

  it('drops anything invalid, and refuses a plan with an impossible length', () => {
    sessionStorage.setItem('tg_next_plan', JSON.stringify({ duration_limit: 20, mood: 'wild', mode: 'insane', desired_outcome: 'win', social_available: 'yes' }))
    expect(takeNextPlan()).toEqual({ duration_limit: 20 })
    for (const bad of [{ duration_limit: 4 }, { duration_limit: 500 }, { duration_limit: 12.5 }, { duration_limit: '30' }, {}]) {
      sessionStorage.setItem('tg_next_plan', JSON.stringify(bad))
      expect(takeNextPlan(), JSON.stringify(bad)).toBeNull()
    }
    sessionStorage.setItem('tg_next_plan', '{broken')
    expect(takeNextPlan()).toBeNull()
  })

  it('never throws when storage is unavailable', () => {
    vi.stubGlobal('sessionStorage', undefined)
    expect(() => queueNextPlan({ duration_limit: 15 })).not.toThrow()
    expect(takeNextPlan()).toBeNull()
  })
})

describe('photos stay on this device and degrade quietly', () => {
  it('shrinks to fit, keeps the shape, and never enlarges', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: MAX_SIDE, height: 480 })
    expect(fitWithin(3000, 4000)).toEqual({ width: 480, height: MAX_SIDE })
    expect(fitWithin(300, 200)).toEqual({ width: 300, height: 200 })
    expect(fitWithin(MAX_SIDE, MAX_SIDE)).toEqual({ width: MAX_SIDE, height: MAX_SIDE })
    expect(fitWithin(10_000, 1)).toEqual({ width: MAX_SIDE, height: 1 })
  })

  it('copes with nonsense dimensions', () => {
    expect(fitWithin(0, 0)).toEqual({ width: MAX_SIDE, height: MAX_SIDE })
    expect(fitWithin(Number.NaN, 100)).toEqual({ width: MAX_SIDE, height: MAX_SIDE })
    expect(fitWithin(-5, 100)).toEqual({ width: MAX_SIDE, height: MAX_SIDE })
  })

  it('reports failure instead of throwing when the browser cannot keep photos', async () => {
    // (the test environment has no IndexedDB and no image decoding, exactly like a locked-down browser)
    expect(await keepPhoto('r_1', new Blob(['x']))).toBe(false)
    expect(await loadPhotoUrl('r_1')).toBeNull()
    await expect(forgetPhoto('r_1')).resolves.toBeUndefined()
    await expect(forgetAllPhotos()).resolves.toBeUndefined()
  })
})
