import type { ContextResponse, Location, PlacesResponse } from '@/shared/context'
import type { NearbyResponse } from '@/shared/places'
import type {
  ApiErrorBody,
  FeedbackInput,
  FeedbackResponse,
  HistoryResponse,
  ProfileInput,
  ProfilePatch,
  ProfileLookupResponse,
  ProfileResponse,
  RecommendInput,
  RecommendResponse,
  UpgradeResponse,
} from '@/shared/api'
import { planOnDevice } from './local-plan'
import { cacheProfile, clearCachedProfile, loadCachedProfile } from './mission-store'
import { getSessionId } from './session'

/** Anything that goes wrong talking to the server, in one shape the screens can handle. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string

  /** `status` 0 means the request never got an answer (offline, timeout, cancelled). */
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

const DEFAULT_TIMEOUT_MS = 10_000

interface RequestOptions {
  body?: unknown
  /** Lets a screen cancel the request (e.g. when the user leaves). */
  signal?: AbortSignal
  timeoutMs?: number
}

async function request<T>(method: string, path: string, { body, signal, timeoutMs = DEFAULT_TIMEOUT_MS }: RequestOptions = {}): Promise<T> {
  const timeout = AbortSignal.timeout(timeoutMs)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout

  let res: Response
  try {
    res = await fetch(path, {
      method,
      headers: {
        'x-session-id': getSessionId(),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: combined,
    })
  } catch (err) {
    const name = (err as { name?: string })?.name
    if (name === 'TimeoutError') throw new ApiError(0, 'timeout', 'The request took too long.')
    if (name === 'AbortError') throw new ApiError(0, 'cancelled', 'The request was cancelled.')
    throw new ApiError(0, 'network', 'Could not reach the server. Check your connection.')
  }

  let json: unknown = null
  try {
    json = await res.json()
  } catch {
    /* body is not JSON; handled below */
  }

  if (!res.ok) {
    const e = (json as Partial<ApiErrorBody> | null)?.error
    throw new ApiError(res.status, e?.code ?? 'http_error', e?.message ?? `Something went wrong (${res.status}).`)
  }
  if (json === null) throw new ApiError(res.status, 'bad_response', 'The server sent an unexpected answer.')
  return json as T
}

/** Keeps a browser-side copy of the profile so a server-side storage outage does not stop recommendations. */
function remember(res: ProfileResponse): ProfileResponse {
  const p = res.profile
  cacheProfile({
    preferences: p.preferences,
    motivators: p.motivators,
    avoidances: p.avoidances,
    equipment: p.equipment,
    goals: p.goals ?? [],
    best_windows: p.schedule_signals.best_windows,
  })
  return res
}

/** `null` means "no profile yet" (a normal state, not an error). */
export async function getProfile(signal?: AbortSignal): Promise<ProfileResponse | null> {
  try {
    const res = await request<ProfileLookupResponse>('GET', '/api/profile', { signal })
    return res.profile === null ? null : remember(res as ProfileResponse)
  } catch (err) {
    // Older servers answered 404 for "no profile yet"; still understood.
    if (err instanceof ApiError && err.code === 'profile_not_found') return null
    throw err
  }
}

export const saveProfile = async (input: ProfileInput) => remember(await request<ProfileResponse>('POST', '/api/onboarding', { body: input }))
export const patchProfile = async (patch: ProfilePatch) => remember(await request<ProfileResponse>('PATCH', '/api/profile', { body: patch }))
export const deleteProfile = async () => {
  const r = await request<{ deleted: boolean }>('DELETE', '/api/profile')
  clearCachedProfile() // "Delete my data" removes the browser copy too
  return r
}

/** The server could not be reached or is broken (as opposed to answering "no" on purpose). */
function serverUnreachable(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false
  return err.status === 0 ? err.code !== 'cancelled' : err.status >= 500 || err.code === 'bad_response'
}

export async function recommend(input: RecommendInput, signal?: AbortSignal): Promise<RecommendResponse> {
  try {
    return await request<RecommendResponse>('POST', '/api/recommend', { body: input, signal })
  } catch (err) {
    const cached = loadCachedProfile()
    if (!cached || signal?.aborted) throw err

    // 1. Saved data is unreachable but the server is up: retry ONCE with the profile kept in this browser.
    if (err instanceof ApiError && err.code === 'storage_unavailable') {
      try {
        return await request<RecommendResponse>('POST', '/api/recommend', { body: { ...input, fallback_profile: cached }, signal })
      } catch (second) {
        if (!serverUnreachable(second)) throw second
      }
    } else if (!serverUnreachable(err)) {
      throw err // e.g. "no profile yet" or "invalid request": the server answered on purpose, so respect it
    }

    // 2. The server cannot be reached at all: plan on this device with the same engine.
    return planOnDevice(input, cached)
  }
}

/**
 * Asks the server to improve a recommendation that is already on screen. Always resolves with
 * `{ upgraded: false }` rather than failing when the AI cannot help; only a real transport problem throws.
 */
export const upgradeRecommendation = (id: string, signal?: AbortSignal) =>
  request<UpgradeResponse>('POST', `/api/recommend/${encodeURIComponent(id)}/upgrade`, { signal, timeoutMs: 12_000 })

/** What it is like outside at a place the person chose to share (rounded, never stored by us). */
export const getConditions = (location: Location, signal?: AbortSignal) =>
  request<ContextResponse>('POST', '/api/context', { body: { location }, signal, timeoutMs: 8_000 })

/** City search, the alternative to sharing the device location. */
export const searchPlaces = (q: string, signal?: AbortSignal) =>
  request<PlacesResponse>('POST', '/api/places', { body: { q }, signal, timeoutMs: 8_000 })

/** A few real places near the shared location for this activity (OpenStreetMap). Optional; never blocks the mission. */
export const getNearby = (location: Location, activityId: string, signal?: AbortSignal) =>
  request<NearbyResponse>('POST', '/api/nearby', { body: { location, activity_id: activityId }, signal, timeoutMs: 9_000 })

export const sendFeedback = (input: FeedbackInput) => request<FeedbackResponse>('POST', '/api/feedback', { body: input })
export const getHistory = (limit = 30, signal?: AbortSignal) => request<HistoryResponse>('GET', `/api/history?limit=${limit}`, { signal })
