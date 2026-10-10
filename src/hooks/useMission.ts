import { useCallback, useEffect, useRef, useState } from 'react'
import type { RecommendResponse } from '@/shared/api'
import type { Location } from '@/shared/context'
import type { ActivityMode, Mood, SkipReason } from '@/shared/engine/types'
import { ApiError, recommend, sendFeedback, upgradeRecommendation } from '@/lib/api'
import { clearMission, loadMission, saveMission } from '@/lib/mission-store'

export interface PlanContext {
  duration_limit: number
  mood: Mood
  social_available: boolean
  /** 'auto' lets the server adapt to energy and recent history. */
  mode?: 'auto' | ActivityMode
  /** Only when the person shared one. Rounded; used for the weather lookup and never stored. */
  location?: Location
}

export type MissionPhase =
  /** Nothing asked for yet. */
  | { kind: 'idle' }
  /** Waiting for the engine's pick (normally a fraction of a second). */
  | { kind: 'loading' }
  /** On screen. `upgrading` is true while the AI is being asked to improve it (at most ~6 s). */
  | { kind: 'shown'; rec: RecommendResponse; upgrading: boolean }
  /** The person tapped "Let's go" and is away from the screen. */
  | { kind: 'going'; rec: RecommendResponse }
  | { kind: 'needs_profile' }
  | { kind: 'error'; message: string }

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  return 'Something went wrong. Please try again.'
}

/**
 * The mission flow, in the order the report asks for:
 *   1. ask for the engine's pick with the AI skipped -> it appears immediately;
 *   2. in the background ask the server to upgrade THAT recommendation with the AI;
 *   3. if the AI helps, swap the wording in (only if the person has not already acted); if not, change nothing.
 */
export function useMission() {
  const [phase, setPhase] = useState<MissionPhase>(() => {
    const saved = loadMission()
    if (!saved) return { kind: 'idle' }
    return saved.stage === 'going' ? { kind: 'going', rec: saved.recommendation } : { kind: 'shown', rec: saved.recommendation, upgrading: false }
  })

  // Always-current copies for async callbacks, so a late AI answer can check what the person is doing NOW.
  const phaseRef = useRef(phase)
  useEffect(() => {
    phaseRef.current = phase
  }, [phase])
  /** Cancels the in-flight request/upgrade when a newer one starts or the screen closes. */
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const upgrade = useCallback(async (rec: RecommendResponse, signal: AbortSignal) => {
    try {
      const result = await upgradeRecommendation(rec.recommendation_id, signal)
      const current = phaseRef.current
      // Apply only if this exact mission is still the one being shown and has not been acted on.
      const stillShown = current.kind === 'shown' && current.rec.recommendation_id === rec.recommendation_id
      if (result.upgraded && result.recommendation && stillShown) {
        saveMission({ recommendation: result.recommendation, stage: 'shown', shownAt: Date.now() })
        setPhase({ kind: 'shown', rec: result.recommendation, upgrading: false })
        return
      }
    } catch {
      /* The AI step is optional: any failure just means the engine pick stays. */
    }
    if (!signal.aborted) {
      setPhase((p) => (p.kind === 'shown' && p.rec.recommendation_id === rec.recommendation_id ? { ...p, upgrading: false } : p))
    }
  }, [])

  const plan = useCallback(
    async (ctx: PlanContext) => {
      abortRef.current?.abort()
      const ac = new AbortController()
      abortRef.current = ac
      setPhase({ kind: 'loading' })
      try {
        const rec = await recommend(
          { ...ctx, use_ai: false, utc_offset_minutes: -new Date().getTimezoneOffset() },
          ac.signal,
        )
        if (ac.signal.aborted) return
        saveMission({ recommendation: rec, stage: 'shown', shownAt: Date.now() })
        setPhase({ kind: 'shown', rec, upgrading: true })
        void upgrade(rec, ac.signal)
      } catch (err) {
        if (ac.signal.aborted || (err instanceof ApiError && err.code === 'cancelled')) return
        if (err instanceof ApiError && err.code === 'profile_not_found') setPhase({ kind: 'needs_profile' })
        else setPhase({ kind: 'error', message: errorMessage(err) })
      }
    },
    [upgrade],
  )

  /** "Let's go": the person is leaving the screen. Stops any pending upgrade so nothing changes under them. */
  const go = useCallback(() => {
    const current = phaseRef.current
    if (current.kind !== 'shown') return
    abortRef.current?.abort()
    // "wentAt" starts the clock on time away from the app; the Meadow credits that time honestly.
    saveMission({ recommendation: current.rec, stage: 'going', shownAt: Date.now(), wentAt: Date.now(), questsTicked: [] })
    setPhase({ kind: 'going', rec: current.rec })
  }, [])

  /** "Not this one": tells the server (so it learns), then asks for a different pick with the same context. */
  const swap = useCallback(
    async (reason: SkipReason | undefined, ctx: PlanContext) => {
      const current = phaseRef.current
      if (current.kind !== 'shown') return
      abortRef.current?.abort()
      try {
        await sendFeedback({
          recommendation_id: current.rec.recommendation_id,
          outcome: 'changed',
          ...(reason ? { skip_reason: reason } : {}),
        })
      } catch {
        /* Learning from this swap is nice to have; the person still gets their next idea. */
      }
      clearMission()
      await plan(ctx)
    },
    [plan],
  )

  /** Forget the mission shown here (after feedback was given elsewhere). */
  const reset = useCallback(() => {
    abortRef.current?.abort()
    clearMission()
    setPhase({ kind: 'idle' })
  }, [])

  return { phase, plan, go, swap, reset }
}
