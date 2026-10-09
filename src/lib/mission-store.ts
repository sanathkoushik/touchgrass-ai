import type { RecommendResponse } from '@/shared/api'

const KEY = 'tg_mission'
const ID = /^r_[0-9a-f-]{36}$/

/**
 * The mission the person is currently on. Kept in this browser so they can leave the app, go outside,
 * and come back to say how it went. It is a convenience copy: the server has the real record.
 */
export interface StoredMission {
  recommendation: RecommendResponse
  /** 'shown' = on screen; 'going' = they tapped "Let's go" and left. */
  stage: 'shown' | 'going'
  /** Epoch ms when it was first shown. */
  shownAt: number
}

export function loadMission(): StoredMission | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const m = JSON.parse(raw) as Partial<StoredMission>
    const r = m.recommendation
    if (!r || typeof r.recommendation_id !== 'string' || !ID.test(r.recommendation_id)) return null
    if (m.stage !== 'shown' && m.stage !== 'going') return null
    if (typeof r.title !== 'string' || typeof r.first_step !== 'string' || typeof r.reason !== 'string') return null
    return { recommendation: r, stage: m.stage, shownAt: typeof m.shownAt === 'number' ? m.shownAt : Date.now() }
  } catch {
    return null
  }
}

export function saveMission(mission: StoredMission): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(mission))
  } catch {
    /* storage unavailable: the mission still works for this visit */
  }
}

export function clearMission(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* nothing to clear */
  }
}

/** A cheap hint so the home screen can pick the right button instantly, before the server has answered. */
const PROFILE_HINT = 'tg_has_profile'

export function hasProfileHint(): boolean {
  try {
    return localStorage.getItem(PROFILE_HINT) === '1'
  } catch {
    return false
  }
}

export function setProfileHint(has: boolean): void {
  try {
    if (has) localStorage.setItem(PROFILE_HINT, '1')
    else localStorage.removeItem(PROFILE_HINT)
  } catch {
    /* storage unavailable */
  }
}
