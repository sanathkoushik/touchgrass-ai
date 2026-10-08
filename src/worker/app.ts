import { zValidator } from '@hono/zod-validator'
import { Hono, type Context as HonoContext } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { secureHeaders } from 'hono/secure-headers'
import type { ZodType } from 'zod'
import {
  feedbackInputSchema,
  historyQuerySchema,
  profileInputSchema,
  profilePatchSchema,
  recommendInputSchema,
  sessionIdSchema,
  type ApiErrorBody,
  type FeedbackResponse,
  type HistoryResponse,
  type ProfileInput,
  type ProfileResponse,
  type ProfileStats,
  type RecommendResponse,
  type StoredProfile,
} from '@/shared/api'
import { getActivity, planDeterministic } from '@/shared/engine'
import type { Context as EngineContext, HistoryEvent, UserProfile } from '@/shared/engine/types'
import type { Repository, StoredEvent } from './repository'
import { localClock, offsetFromTimeZone } from './time'

export interface AppDeps {
  /** A repository, or a factory that builds one from the request's bindings (e.g. env.DB). */
  repo: Repository | ((env: Env) => Repository)
  /** Injectable clock so tests can control the time of day. */
  now?: () => Date
}

type AppEnv = {
  Bindings: Env
  Variables: { userKey: string }
}

const MAX_BODY_BYTES = 16 * 1024
/** How much history the recommender looks at. */
const HISTORY_WINDOW = 100

// ------------------------------------------------------------------ helpers

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

/** The user's offset: what the browser told us, else the edge's time zone for this request, else UTC. */
function resolveOffsetMinutes(c: HonoContext<AppEnv>, clientOffset: number | undefined, at: Date): number {
  if (clientOffset !== undefined) return clientOffset
  const tz = (c.req.raw as { cf?: { timezone?: string } }).cf?.timezone
  return (tz ? offsetFromTimeZone(tz, at) : null) ?? 0
}

// ---------------------------------------------------------------------- app

export function createApp({ repo: repoSource, now = () => new Date() }: AppDeps) {
  const app = new Hono<AppEnv>()
  const repoOf = (c: HonoContext<AppEnv>): Repository => (typeof repoSource === 'function' ? repoSource(c.env) : repoSource)

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
    if (!profile) return c.json(errorBody('profile_not_found', 'No profile yet. Complete onboarding first.'), 404)
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

    const profile = await repo.getProfile(userKey)
    if (!profile) return c.json(errorBody('profile_not_found', 'No profile yet. Complete onboarding first.'), 404)

    const at = now()
    const clock = localClock(at, resolveOffsetMinutes(c, input.utc_offset_minutes, at))
    const ctx: EngineContext = {
      duration_limit: input.duration_limit,
      social_available: input.social_available,
      mood: input.mood,
      hour: clock.hour,
    }

    const history = toHistory(await repo.listEvents(userKey, HISTORY_WINDOW))
    const { recommendation } = planDeterministic(toEngineProfile(userKey, profile), ctx, history)

    const recommendationId = `r_${crypto.randomUUID()}`
    let persisted = true
    try {
      await repo.addEvent(userKey, {
        recommendation_id: recommendationId,
        activity_id: recommendation.activity_id,
        timestamp: clock.iso,
        outcome: 'pending',
        context: { duration_limit: ctx.duration_limit, mood: ctx.mood, social_available: ctx.social_available, hour: ctx.hour },
      })
    } catch (err) {
      // Storage trouble must never block the answer: the user still gets their mission.
      persisted = false
      console.error(JSON.stringify({ t: 'persist_failed', where: 'recommend', message: String((err as Error)?.message ?? err) }))
    }

    const body: RecommendResponse = { recommendation_id: recommendationId, ...recommendation, persisted }
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
    if (input.enjoyment !== undefined) updated.enjoyment = input.enjoyment
    if (input.skip_reason !== undefined) updated.skip_reason = input.skip_reason
    await repo.updateEvent(userKey, updated)

    const body: FeedbackResponse = {
      recommendation_id: updated.recommendation_id,
      outcome: input.outcome,
      enjoyment: updated.enjoyment ?? null,
      skip_reason: updated.skip_reason ?? null,
    }
    return c.json(body)
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

  // ---- uniform JSON errors
  app.notFound((c) => c.json(errorBody('not_found', 'No such endpoint'), 404))

  app.onError((err, c) => {
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
