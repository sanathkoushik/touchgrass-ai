import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocationError, clearPlace, loadPlace, requestDeviceLocation, savePlace } from './location'

function fakeStorage() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }
}

beforeEach(() => vi.stubGlobal('localStorage', fakeStorage()))
afterEach(() => vi.unstubAllGlobals())

describe('saved place', () => {
  it('round-trips and rounds to ~1 km even if given more precision', () => {
    savePlace({ lat: 12.971234, lon: 77.594567, label: 'Near you', source: 'device' })
    expect(loadPlace()).toEqual({ lat: 12.97, lon: 77.59, label: 'Near you', source: 'device' })
    expect(localStorage.getItem('tg_place')).not.toContain('12.971234')
  })

  it('can be cleared', () => {
    savePlace({ lat: 1, lon: 2, label: 'X', source: 'search' })
    clearPlace()
    expect(loadPlace()).toBeNull()
  })

  it.each([
    ['garbage', 'not json'],
    ['out of range', JSON.stringify({ lat: 99, lon: 0, label: 'X', source: 'search' })],
    ['no label', JSON.stringify({ lat: 1, lon: 0, label: '', source: 'search' })],
    ['bad source', JSON.stringify({ lat: 1, lon: 0, label: 'X', source: 'gps' })],
    ['wrong types', JSON.stringify({ lat: '1', lon: 0, label: 'X', source: 'search' })],
  ])('ignores a corrupt entry (%s)', (_n, raw) => {
    localStorage.setItem('tg_place', raw)
    expect(loadPlace()).toBeNull()
  })

  it('does not crash when storage is unavailable', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => { throw new Error('blocked') } })
    expect(loadPlace()).toBeNull()
    expect(() => savePlace({ lat: 1, lon: 2, label: 'X', source: 'search' })).not.toThrow()
    expect(() => clearPlace()).not.toThrow()
  })
})

describe('requestDeviceLocation', () => {
  const geo = (impl: (ok: (p: unknown) => void, fail: (e: { code: number }) => void) => void) =>
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: impl } })

  it('returns a rounded location', async () => {
    geo((ok) => ok({ coords: { latitude: 12.97194, longitude: 77.59369 } }))
    expect(await requestDeviceLocation()).toEqual({ lat: 12.97, lon: 77.59 })
  })

  it.each([
    [1, 'denied'],
    [2, 'unavailable'],
    [3, 'timeout'],
  ])('maps browser error %i to %s with a friendly message', async (code, expected) => {
    geo((_ok, fail) => fail({ code }))
    const err = await requestDeviceLocation().catch((e) => e)
    expect(err).toBeInstanceOf(LocationError)
    expect(err.code).toBe(expected)
    expect(err.message).toMatch(/city/i)
  })

  it('reports an unsupported browser', async () => {
    vi.stubGlobal('navigator', {})
    await expect(requestDeviceLocation()).rejects.toMatchObject({ code: 'unsupported' })
  })
})
