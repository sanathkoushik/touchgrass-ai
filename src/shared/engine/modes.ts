import type { ActivityMode, Context, HistoryEvent, Mood, ModeCause } from './types'

/**
 * The energy the engine should plan for. A "minimum" day plans as low energy (nothing too intense);
 * an "excellent" day plans as high energy, unless the person said they are low.
 */
export function effectiveMood(ctx: Pick<Context, 'mood' | 'mode'>): Mood {
  if (ctx.mode === 'minimum') return 'low'
  if (ctx.mode === 'excellent') return ctx.mood === 'low' ? 'ok' : 'high'
  return ctx.mood
}

function newestFirst(history: HistoryEvent[]): HistoryEvent[] {
  return [...history].sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0))
}

/**
 * Picks the size of today's activity when the person did not choose one.
 *  - the last two answered recommendations were skipped -> minimum ("immediate recovery", no shame);
 *  - low energy -> minimum;
 *  - high energy AND the last two went well (completed, enjoyed 4+) -> excellent;
 *  - otherwise normal.
 * Unanswered recommendations are ignored: not answering is not a failure.
 */
export function chooseMode(history: HistoryEvent[], mood: Mood): { mode: ActivityMode; cause?: ModeCause } {
  const lastTwo = newestFirst(history).slice(0, 2)
  if (lastTwo.length === 2 && lastTwo.every((e) => e.outcome === 'skipped')) return { mode: 'minimum', cause: 'recovery' }
  if (mood === 'low') return { mode: 'minimum', cause: 'low_energy' }
  if (
    mood === 'high' &&
    lastTwo.length === 2 &&
    lastTwo.every((e) => e.outcome === 'completed' && typeof e.enjoyment === 'number' && e.enjoyment >= 4)
  ) {
    return { mode: 'excellent', cause: 'momentum' }
  }
  return { mode: 'normal' }
}
