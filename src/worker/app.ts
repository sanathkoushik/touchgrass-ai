import { zValidator } from '@hono/zod-validator'
import { Hono, type Context as HonoContext } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { secureHeaders } from 'hono/secure-headers'
import type { ZodType } from 'zod'
import {
  feedbackInputSchema,
  historyQuerySchema,
  meadowQuerySchema,
  profileInputSchema,
  profilePatchSchema,
  recommendInputSchema,
  recommendationIdSchema,
  sessionIdSchema,
  type ApiErrorBody,
  type FeedbackResponse,
  type HistoryResponse,
  type ProfileInput,
  type ProfileLookupResponse,
  type ProfileResponse,
  type ProfileStats,
  type RecommendResponse,
  type StoredProfile,
  type UpgradeResponse,
} from '@/shared/api'
import { chooseMode, getActivity, planDeterministic } from '@/shared/engine'
import type { Context as EngineContext, HistoryEvent, UserProfile } from '@/shared/engine/types'
import { contextInputSchema, placesInputSchema, roundLocation, type ConditionsSummary, type ContextResponse, type Location, type PlacesResponse } from '@/shared/context'
import { computeMeadow, creditedMinutes, localDate, newMilestones, type MeadowEvent, type RewardSummary } from '@/shared/meadow'
import { AiGate } from './ai/gate'
import type { AiProvider } from './ai/provider'
import { refineWithAi } from './ai/refine'
import type { NearbyProvider } from './context/overpass'
import type { PlaceCache } from './context/place-cache'
import { PLACE_KINDS, placeKindFor, type NearbyResponse } from '@/shared/places'
import { nearbyInputSchema } from '@/shared/places-schema'
import type { Conditions, ContextProvider } from './context/provider'
import type { Repository, StoredEvent } from './repository'
import { localClock, offsetFromTimeZone } from './time'

export interface AppDeps {
  /** A repository, or a factory that builds one from the request's bindings (e.g. env.DB). */
  repo: Repository | ((env: Env) => Repository)
  /** Injectable clock so tests can control the time of day. */
  now?: () => Date
  /**
   * Optional AI. `provider` may return null when no AI is available (e.g. the binding is missing),
   * in which case every request is answered by the deterministic engine.
   */
  ai?: {
    provider: (env: Env) => AiProvider | null
    gate?: AiGate
    timeoutMs?: number
  }
  /** Live weather and place search. Without it the app plans without weather. */
  context?: ContextProvider
  /** Real nearby places (OpenStreetMap). Without it the app simply shows no places. */
  places?: NearbyProvider
  /** Shared cache for those places (D1), so the busy public server is asked as rarely as possible. */
  placeCache?: (env: Env) => PlaceCache
}

type AppEnv = {
  Bindings: Env
  Variables: { userKey: string }
}

const MAX_BODY_BYTES = 16 * 1024
/** How much history the recommender looks at. */
const HISTORY_WINDOW = 100

// ------------------------------------------------------------------ helpers

/** Saved data could not be read or written. Becomes a clean 503 instead of a crash. */
export class StorageError extends Error {
  constructor() {
    super('storage unavailable')
    this.name = 'StorageError'
  }
}

/**
 * Wraps a repository so ANY failure inside it surfaces as a StorageError (the original message is logged without data,
 * never sent to the client).
 */
function guardRepository(repo: Repository): Repository {
  return new Proxy(repo, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (typeof value !== 'function') return value
      return async (...args: unknown[]) => {
        try {
          return await (value as (...a: unknown[]) => unknown).apply(target, args)
        } catch (err) {
          console.error(JSON.stringify({ t: 'storage_failed', op: String(prop), message: String((err as Error)?.message ?? err).slice(0, 200) }))
          throw new StorageError()
        }
      }
    },
  })
}

function errorBody(code: string, message: string, details?: ApiErrorBody['error']['details']): ApiErrorBody {
  return { error: { code, message, ...(details ? { details } : {}) } }
}

/** Zod validator that reports problems in our error format instead of Hono's default. */
function validate<T extends ZodType>(target: 'json' | 'query', schema: T) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        path: i.path.map(String).join('.'),
        message: i.message,
      }))
      return c.json(errorBody('invalid_request', 'Request validation failed', details), 400)
    }
  })
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function toStoredProfile(input: ProfileInput, now: Date): StoredProfile {
  return {
    preferences: input.preferences,
    motivators: input.motivators,
    avoidances: input.avoidances,
    equipment: input.equipment,
    goals: input.goals,
    schedule_signals: { best_windows: input.best_windows },
    updated_at: now.toISOString(),
  }
}

function toEngineProfile(userKey: string, p: StoredProfile): UserProfile {
  return {
    user_id: userKey.slice(0, 12),
    preferences: p.preferences,
    motivators: p.motivators,
    avoidances: p.avoidances,
    equipment: p.equipment,
    goals: p.goals ?? [],
  }
}

/** What the Meadow needs from a stored event. */
function toMeadowEvent(e: StoredEvent): MeadowEvent {
  return {
    activity_id: e.activity_id,
    timestamp: e.timestamp,
    outcome: e.outcome,
    ...(e.enjoyment !== undefined ? { enjoyment: e.enjoyment } : {}),
    ...(e.minutes_outside !== undefined ? { minutes_outside: e.minutes_outside } : {}),
    ...(e.quests_done !== undefined ? { quests_done: e.quests_done } : {}),
    ...(e.context.planned_min !== undefined ? { planned_min: e.context.planned_min } : {}),
  }
}

/** Only answered recommendations teach the engine anything. */
function toHistory(events: StoredEvent[]): HistoryEvent[] {
  const out: HistoryEvent[] = []
  for (const e of events) {
    if (e.outcome === 'pending') continue
    out.push({
      activity_id: e.activity_id,
      timestamp: e.timestamp,
      outcome: e.outcome,
      ...(e.enjoyment !== undefined ? { enjoyment: e.enjoyment } : {}),
      ...(e.skip_reason !== undefined ? { skip_reason: e.skip_reason } : {}),
    })
  }
  return out
}

function statsOf(events: StoredEvent[]): ProfileStats {
  const responded = events.filter((e) => e.outcome !== 'pending')
  const completed = responded.filter((e) => e.outcome === 'completed').length
  return {
    recommendations: events.length,
    responded: responded.length,
    completed,
    completion_rate: responded.length === 0 ? null : completed / responded.length,
  }
}

/** Asks the weather service, treating ANY problem as "no weather": it must never break a recommendation. */
async function safeConditions(provider: ContextProvider, loc: Location): Promise<Conditions | null> {
  try {
    return await provider.conditions(loc.lat, loc.lon)
  } catch {
    return null
  }
}

/** The conditions shown to the person, from what the recommendation was actually made with. */
function summaryOf(ctx: EngineContext): ConditionsSummary | undefined {
  if (!ctx.weather || typeof ctx.is_daylight !== 'boolean') return undefined
  return { weather: ctx.weather, daylight: ctx.is_daylight ? 'day' : 'night' }
}

/** The user's offset: what the browser told us, else the edge's time zone for this request, else UTC. */
function resolveOffsetMinutes(c: HonoContext<AppEnv>, clientOffset: number | undefined, at: Date): number {
  if (clientOffset !== undefined) return clientOffset
  const tz = (c.req.raw as { cf?: { timezone?: string } }).cf?.timezone
  return (tz ? offsetFromTimeZone(tz, at) : null) ?? 0
}

// ---------------------------------------------------------------------- app

export function createApp({ repo: repoSource, now = () => new Date(), ai, context, places: placesProvider, placeCache }: AppDeps) {
  const app = new Hono<AppEnv>()
  const aiGate = ai?.gate ?? new AiGate()
  const repoOf = (c: HonoContext<AppEnv>): Repository => guardRepository(typeof repoSource === 'function' ? repoSource(c.env) : repoSource)

  app.use('*', secureHeaders())

  // One structured log line per request. Never logs bodies, headers or session ids.
  app.use('*', async (c, next) => {
    const started = Date.now()
    await next()
    console.log(JSON.stringify({ t: 'req', method: c.req.method, path: c.req.path, status: c.res.status, ms: Date.now() - started }))
  })

  // ---- health (no session needed)
  const health = (c: HonoContext<AppEnv>) => c.json({ status: 'ok', service: 'touchgrass-ai', time: now().toISOString() })
  app.get('/health', health)
  app.get('/api/health', health)

  // ---- everything else under /api needs a well-formed anonymous session id
  app.use(
    '/api/*',
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => c.json(errorBody('payload_too_large', `Request body must be under ${MAX_BODY_BYTES} bytes`), 413),
    }),
  )
  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    if (c.req.path === '/api/health') return next()
    const parsed = sessionIdSchema.safeParse(c.req.header('x-session-id'))
    if (!parsed.success) {
      return c.json(errorBody('session_required', 'Send a valid X-Session-Id header (a UUID generated by the client)'), 401)
    }
    c.set('userKey', await sha256Hex(parsed.data))
    await next()
  })

  // ---- onboarding: create or replace the profile
  app.post('/api/onboarding', validate('json', profileInputSchema), async (c) => {
    const repo = repoOf(c)
    const input = c.req.valid('json')
    const profile = toStoredProfile(input, now())
    await repo.saveProfile(c.get('userKey'), profile)
    const body: ProfileResponse = { profile, stats: statsOf([]) }
    return c.json(body, 200)
  })

  // ---- profile: read / partial update / delete
  app.get('/api/profile', async (c) => {
    const repo = repoOf(c)
    const userKey = c.get('userKey')
    const profile = await repo.getProfile(userKey)
    // Not having a profile yet is the normal first-visit state, so it is a plain 200 (no red error in the browser console).
    if (!profile) return c.json({ profile: null } satisfies ProfileLookupResponse)
    const body: ProfileResponse = { profile, stats: statsOf(await repo.listEvents(userKey, 1000)) }
    return c.json(body)
  })

  app.patch('/api/profile', validate('json', profilePatchSchema), async (c) => {
    const repo = repoOf(c)
    const userKey = c.get('userKey')
    const existing = await repo.getProfile(userKey)
    if (!existing) return c.json(errorBody('profile_not_found', 'No profile yet. Complete onboarding first.'), 404)
    const patch = c.req.valid('json')
    const merged: StoredProfile = {
      preferences: { ...existing.preferences, ...patch.preferences },
      motivators: patch.motivators ?? existing.motivators,
      avoidances: patch.avoidances ?? existing.avoidances,
      equipment: patch.equipment ?? existing.equipment,
      goals: patch.goals ?? existing.goals ?? [],
      schedule_signals: { best_windows: patch.best_windows ?? existing.schedule_signals.best_windows },
      updated_at: now().toISOString(),
    }
    await repo.saveProfile(userKey, merged)
    const body: ProfileResponse = { profile: merged, stats: statsOf(await repo.listEvents(userKey, 1000)) }
    return c.json(body)
  })

  app.delete('/api/profile', async (c) => {
    const repo = repoOf(c)
    await repo.deleteUser(c.get('userKey'))
    return c.json({ deleted: true })
  })

  // ---- recommend: filter -> score -> deterministic plan (Gemma joins in a later stage)
  app.post('/api/recommend', validate('json', recommendInputSchema), async (c) => {
    const repo = repoOf(c)
    const userKey = c.get('userKey')
    const input = c.req.valid('json')

    // If saved data is unreachable but the browser sent its last-known profile, plan from that (no history, nothing saved).
    let storageDown = false
    let profile: StoredProfile | null
    let storedHistory: StoredEvent[] = []
    try {
      profile = await repo.getProfile(userKey)
      if (profile) storedHistory = await repo.listEvents(userKey, HISTORY_WINDOW)
    } catch (err) {
      if (!(err instanceof StorageError) || !input.fallback_profile) throw err
      storageDown = true
      profile = toStoredProfile(input.fallback_profile, now())
    }
    if (!profile) return c.json(errorBody('profile_not_found', 'No profile yet. Complete onboarding first.'), 404)

    const at = now()

    // Live conditions, only if the person shared a location. Rounded to ~1 km, used for this one lookup, never stored.
    // If the weather service is slow or down we simply plan without weather.
    const conditions = input.location && context ? await safeConditions(context, roundLocation(input.location)) : null

    // The place's own clock when we know it (so "daylight" and "late at night" are right THERE), else the browser's.
    const offsetMinutes = conditions ? Math.round(conditions.utc_offset_seconds / 60) : resolveOffsetMinutes(c, input.utc_offset_minutes, at)
    const clock = localClock(at, offsetMinutes)
    const history = toHistory(storedHistory)
    // The person's own choice wins; otherwise adapt to their energy and what has happened lately.
    const sizing = input.mode === 'auto' ? chooseMode(history, input.mood) : { mode: input.mode, cause: 'chosen' as const }
    const ctx: EngineContext = {
      duration_limit: input.duration_limit,
      social_available: input.social_available,
      mood: input.mood,
      mode: sizing.mode,
      ...(sizing.cause ? { mode_cause: sizing.cause } : {}),
      hour: clock.hour,
      ...(conditions ? { weather: { category: conditions.category, temp_c: conditions.temp_c }, is_daylight: conditions.is_day } : {}),
    }

    const engineProfile = toEngineProfile(userKey, profile)
    const planned = planDeterministic(engineProfile, ctx, history)
    let recommendation = planned.recommendation

    // The AI may improve the choice and the wording, but the deterministic answer above is always the safety net.
    const provider = input.use_ai ? (ai?.provider(c.env) ?? null) : null
    if (provider && aiGate.canTry(at.getTime())) {
      const refined = await refineWithAi({
        provider,
        profile: engineProfile,
        ctx,
        ranking: planned.ranking,
        deterministic: planned.recommendation,
        timeoutMs: ai?.timeoutMs,
      })
      aiGate.record(refined.outcome.status, now().getTime())
      // Operational numbers only: never the prompt, the reply, or anything about the person.
      console.log(
        JSON.stringify({
          t: 'ai',
          status: refined.outcome.status,
          attempts: refined.outcome.attempts,
          ms: refined.outcome.ms,
          in: refined.outcome.inputTokens,
          out: refined.outcome.outputTokens,
          neurons: refined.outcome.neurons && Math.round(refined.outcome.neurons * 100) / 100,
        }),
      )
      recommendation = refined.recommendation
    }

    const recommendationId = `r_${crypto.randomUUID()}`
    let persisted = !storageDown
    try {
      if (storageDown) throw new StorageError() // already known to be down: do not wait on another failing call
      await repo.addEvent(userKey, {
        recommendation_id: recommendationId,
        activity_id: recommendation.activity_id,
        timestamp: clock.iso,
        outcome: 'pending',
        // Stored with the recommendation: the conditions it was made under (never the location itself), so the
        // upgrade step rebuilds exactly the same situation.
        context: {
          duration_limit: ctx.duration_limit,
          mood: ctx.mood,
          social_available: ctx.social_available,
          hour: ctx.hour,
          planned_min: recommendation.duration_min,
          ...(ctx.mode ? { mode: ctx.mode } : {}),
          ...(ctx.mode_cause ? { mode_cause: ctx.mode_cause } : {}),
          ...(ctx.weather ? { weather: ctx.weather } : {}),
          ...(typeof ctx.is_daylight === 'boolean' ? { is_daylight: ctx.is_daylight } : {}),
        },
      })
    } catch (err) {
      // Storage trouble must never block the answer: the user still gets their mission.
      persisted = false
      console.error(JSON.stringify({ t: 'persist_failed', where: 'recommend', message: String((err as Error)?.message ?? err) }))
    }

    const summary = summaryOf(ctx)
    const body: RecommendResponse = { recommendation_id: recommendationId, ...recommendation, persisted, ...(summary ? { context: summary } : {}) }
    return c.json(body)
  })

  // ---- upgrade: let the AI improve a recommendation the screen has ALREADY shown (engine pick first, AI second)
  app.post('/api/recommend/:id/upgrade', async (c) => {
    const repo = repoOf(c)
    const userKey = c.get('userKey')
    const id = recommendationIdSchema.safeParse(c.req.param('id'))
    if (!id.success) return c.json(errorBody('invalid_request', 'Invalid recommendation id'), 400)

    // Looked up under THIS user's key, like feedback: nobody can upgrade someone else's recommendation.
    const event = await repo.getEvent(userKey, id.data)
    if (!event) return c.json(errorBody('recommendation_not_found', 'No such recommendation for this session'), 404)
    // Once the user has answered, the record is history: never rewrite it.
    if (event.outcome !== 'pending') return c.json(errorBody('already_answered', 'This recommendation has already been answered'), 409)

    const notUpgraded = (reason: NonNullable<UpgradeResponse['reason']>) => c.json<UpgradeResponse>({ upgraded: false, reason })
    // Each recommendation gets at most ONE upgrade attempt, so a client cannot burn the free AI quota by retrying.
    if (event.context.upgrade) return notUpgraded('already_attempted')

    const provider = ai?.provider(c.env) ?? null
    if (!provider) return notUpgraded('ai_unavailable')
    if (!aiGate.canTry(now().getTime())) return notUpgraded('ai_cooling_down')

    const profile = await repo.getProfile(userKey)
    if (!profile) return c.json(errorBody('profile_not_found', 'No profile yet. Complete onboarding first.'), 404)

    // Rebuild exactly what the user was shown from the context stored with the recommendation.
    const ctx: EngineContext = {
      duration_limit: event.context.duration_limit,
      social_available: event.context.social_available,
      mood: event.context.mood,
      hour: event.context.hour,
      ...(event.context.mode ? { mode: event.context.mode } : {}),
      ...(event.context.mode_cause ? { mode_cause: event.context.mode_cause } : {}),
      ...(event.context.weather ? { weather: event.context.weather } : {}),
      ...(typeof event.context.is_daylight === 'boolean' ? { is_daylight: event.context.is_daylight } : {}),
    }
    const engineProfile = toEngineProfile(userKey, profile)
    const history = toHistory(await repo.listEvents(userKey, HISTORY_WINDOW))
    const planned = planDeterministic(engineProfile, ctx, history)
    const refined = await refineWithAi({
      provider,
      profile: engineProfile,
      ctx,
      ranking: planned.ranking,
      deterministic: planned.recommendation,
      timeoutMs: ai?.timeoutMs,
    })
    aiGate.record(refined.outcome.status, now().getTime())
    console.log(
      JSON.stringify({
        t: 'ai',
        phase: 'upgrade',
        status: refined.outcome.status,
        attempts: refined.outcome.attempts,
        ms: refined.outcome.ms,
        in: refined.outcome.inputTokens,
        out: refined.outcome.outputTokens,
        neurons: refined.outcome.neurons && Math.round(refined.outcome.neurons * 100) / 100,
      }),
    )

    const ok = refined.outcome.status === 'ok'
    try {
      await repo.updateEvent(userKey, {
        ...event,
        activity_id: ok ? refined.recommendation.activity_id : event.activity_id,
        context: { ...event.context, upgrade: ok ? 'ai' : 'failed', ...(ok ? { planned_min: refined.recommendation.duration_min } : {}) },
      })
    } catch (err) {
      // If we cannot save the upgraded choice, do not show it: the screen and the record must agree.
      console.error(JSON.stringify({ t: 'persist_failed', where: 'upgrade', message: String((err as Error)?.message ?? err) }))
      return notUpgraded('ai_failed')
    }
    if (!ok) return notUpgraded('ai_failed')
    const upgradedSummary = summaryOf(ctx)
    const body: UpgradeResponse = {
      upgraded: true,
      recommendation: { recommendation_id: id.data, ...refined.recommendation, persisted: true, ...(upgradedSummary ? { context: upgradedSummary } : {}) },
    }
    return c.json(body)
  })

  // ---- feedback: record what happened
  app.post('/api/feedback', validate('json', feedbackInputSchema), async (c) => {
    const repo = repoOf(c)
    const userKey = c.get('userKey')
    const input = c.req.valid('json')

    // Looked up under THIS user's key, so one session can never touch another's events.
    const event = await repo.getEvent(userKey, input.recommendation_id)
    if (!event) return c.json(errorBody('recommendation_not_found', 'No such recommendation for this session'), 404)

    const updated: StoredEvent = { ...event, outcome: input.outcome, responded_at: now().toISOString() }
    delete updated.enjoyment
    delete updated.skip_reason
    delete updated.minutes_outside
    delete updated.quests_done
    if (input.enjoyment !== undefined) updated.enjoyment = input.enjoyment
    if (input.skip_reason !== undefined) updated.skip_reason = input.skip_reason
    if (input.minutes_outside !== undefined) updated.minutes_outside = input.minutes_outside
    if (input.quests_done !== undefined) updated.quests_done = input.quests_done

    // What the Meadow looked like before this answer (this mission as it was stored), so only genuinely new
    // milestones are celebrated, and answering the same mission twice never celebrates twice.
    const credited = updated.outcome === 'completed' || updated.outcome === 'partial'
    const others = credited ? (await repo.listCredited(userKey, 2000)).filter((e) => e.recommendation_id !== updated.recommendation_id) : []
    const wasCredited = event.outcome === 'completed' || event.outcome === 'partial'
    await repo.updateEvent(userKey, updated)

    const body: FeedbackResponse = {
      recommendation_id: updated.recommendation_id,
      outcome: input.outcome,
      enjoyment: updated.enjoyment ?? null,
      skip_reason: updated.skip_reason ?? null,
    }
    if (credited) {
      const before = [...others.map(toMeadowEvent), ...(wasCredited ? [toMeadowEvent(event)] : [])]
      const after = [...others.map(toMeadowEvent), toMeadowEvent(updated)]
      const summary = computeMeadow(after, '1970-01-01') // totals only; the date matters for the weekly view, not here
      const reward: RewardSummary = {
        credited_minutes: creditedMinutes(toMeadowEvent(updated)),
        total_minutes: summary.total_minutes,
        missions: summary.missions,
        quests_done: summary.quests_done,
        new_milestones: newMilestones(before, after),
      }
      body.reward = reward
    }
    return c.json(body)
  })

  // ---- meadow: everything the person has added up so far, from their own answers
  app.get('/api/meadow', validate('query', meadowQuerySchema), async (c) => {
    const repo = repoOf(c)
    const at = now()
    const offset = resolveOffsetMinutes(c, c.req.valid('query').utc_offset_minutes, at)
    const credited = await repo.listCredited(c.get('userKey'), 2000)
    return c.json(computeMeadow(credited.map(toMeadowEvent), localDate(at, offset)))
  })

  // ---- history: recent recommendations and outcomes
  app.get('/api/history', validate('query', historyQuerySchema), async (c) => {
    const repo = repoOf(c)
    const { limit } = c.req.valid('query')
    const events = await repo.listEvents(c.get('userKey'), limit)
    const body: HistoryResponse = {
      items: events.map((e) => ({
        recommendation_id: e.recommendation_id,
        timestamp: e.timestamp,
        activity_id: e.activity_id,
        title: getActivity(e.activity_id)?.title ?? e.activity_id,
        outcome: e.outcome,
        enjoyment: e.enjoyment ?? null,
        skip_reason: e.skip_reason ?? null,
      })),
    }
    return c.json(body)
  })

  // ---- context: what it is like outside right now, for a location the person chose to share
  app.post('/api/context', validate('json', contextInputSchema), async (c) => {
    const loc = roundLocation(c.req.valid('json').location)
    const found = context ? await safeConditions(context, loc) : null
    const body: ContextResponse = found
      ? {
          available: true,
          conditions: {
            weather: { category: found.category, temp_c: found.temp_c },
            daylight: found.is_day ? 'day' : 'night',
            ...(found.sunrise ? { sunrise: found.sunrise } : {}),
            ...(found.sunset ? { sunset: found.sunset } : {}),
          },
        }
      : { available: false }
    return c.json(body)
  })

  // ---- places: look a city up by name (the alternative to sharing the device location)
  app.post('/api/places', validate('json', placesInputSchema), async (c) => {
    let places = null
    try {
      places = context ? await context.places(c.req.valid('json').q) : null
    } catch {
      places = null
    }
    const body: PlacesResponse = { available: places !== null, places: places ?? [] }
    return c.json(body)
  })

  // ---- nearby: a few real places for the suggested activity, from OpenStreetMap
  app.post('/api/nearby', validate('json', nearbyInputSchema), async (c) => {
    const input = c.req.valid('json')
    const kind = placeKindFor(input.activity_id)
    // Activities that do not happen at a kind of place (home, any street) have nothing to look up.
    if (!kind) return c.json({ available: true, places: [] } satisfies NearbyResponse)
    const loc = roundLocation(input.location)
    let found = null
    try {
      found = placesProvider ? await placesProvider.nearby(kind, loc.lat, loc.lon, placeCache?.(c.env)) : null
    } catch {
      found = null
    }
    const body: NearbyResponse = found
      ? { available: true, kind: { id: kind, label: PLACE_KINDS[kind].label }, places: found }
      : { available: false, places: [] }
    return c.json(body)
  })

  // ---- uniform JSON errors
  app.notFound((c) => c.json(errorBody('not_found', 'No such endpoint'), 404))

  app.onError((err, c) => {
    if (err instanceof StorageError) {
      return c.json(errorBody('storage_unavailable', 'Your saved data is temporarily out of reach. Please try again in a moment.'), 503)
    }
    if (err instanceof HTTPException) {
      const status = err.status
      return c.json(errorBody(status === 400 ? 'invalid_request' : 'http_error', err.message), status)
    }
    // Unexpected: log details server-side, return nothing sensitive.
    console.error(JSON.stringify({ t: 'unhandled', path: c.req.path, message: String(err?.message ?? err) }))
    return c.json(errorBody('internal_error', 'Something went wrong on our side'), 500)
  })

  return app
}

export type App = ReturnType<typeof createApp>
