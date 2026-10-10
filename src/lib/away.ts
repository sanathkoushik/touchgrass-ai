/** "You just set off." / "You set off 12 minutes ago." / "You set off 1 hour 5 minutes ago." (null if unknown). */
export function awayText(minutes: number | null): string | null {
  if (minutes === null) return null
  if (minutes < 1) return 'You just set off.'
  if (minutes < 60) return `You set off ${minutes} minute${minutes === 1 ? '' : 's'} ago.`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `You set off ${h} hour${h === 1 ? '' : 's'}${m ? ` ${m} minute${m === 1 ? '' : 's'}` : ''} ago.`
}
