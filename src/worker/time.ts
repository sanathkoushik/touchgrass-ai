/**
 * The Worker runs in UTC, but recommendations depend on the USER's local time of day.
 * These helpers turn "a moment" plus "an offset" into the local hour and a local ISO string.
 */

/** Offset in minutes east of UTC for an IANA time zone at a given moment, or null if the zone is unknown. */
export function offsetFromTimeZone(timeZone: string, at: Date): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(at)
    const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? ''
    if (name === 'GMT') return 0
    const m = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(name)
    if (!m) return null
    const minutes = Number(m[2]) * 60 + Number(m[3] ?? 0)
    return m[1] === '-' ? -minutes : minutes
  } catch {
    return null
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Local hour (0-23) and an ISO-8601 string carrying the offset, e.g. "2026-10-07T17:42:00+05:30". */
export function localClock(at: Date, offsetMinutes: number): { hour: number; iso: string } {
  const shifted = new Date(at.getTime() + offsetMinutes * 60_000)
  const sign = offsetMinutes < 0 ? '-' : '+'
  const abs = Math.abs(offsetMinutes)
  const iso = `${shifted.toISOString().slice(0, 19)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  return { hour: shifted.getUTCHours(), iso }
}
