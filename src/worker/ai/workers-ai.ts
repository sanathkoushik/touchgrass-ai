import { AiUnavailableError, type AiCompletion, type AiProvider, type AiRequest } from './provider'

/** Gemma 4 26B A4B on Cloudflare Workers AI: stays on the Workers Free plan (Cloudflare changelog, 2026-07-28). */
export const GEMMA_MODEL = '@cf/google/gemma-4-26b-a4b-it'

/** The slice of the Workers AI binding we use. Kept minimal so tests can fake it. */
export interface AiBinding {
  run(model: string, input: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>
}

/** Pulls the model's text out of the response shapes Workers AI can return. */
export function extractText(out: unknown): string | null {
  if (!out || typeof out !== 'object') return typeof out === 'string' ? out : null
  const o = out as { choices?: { message?: { content?: unknown } }[]; response?: unknown }
  const content = o.choices?.[0]?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const joined = content
      .map((p) => (p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string' ? (p as { text: string }).text : ''))
      .join('')
    if (joined) return joined
  }
  if (typeof o.response === 'string') return o.response
  // JSON mode on some models returns an already-parsed object.
  if (o.response && typeof o.response === 'object') return JSON.stringify(o.response)
  return null
}

function extractUsage(out: unknown): AiCompletion['usage'] {
  const u = (out as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } } | null)?.usage
  if (typeof u?.prompt_tokens === 'number' && typeof u?.completion_tokens === 'number') {
    return { inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens }
  }
  return undefined
}

/** Maps whatever Workers AI threw onto our four failure kinds. Messages are matched loosely on purpose. */
export function classifyAiError(err: unknown): AiUnavailableError {
  if (err instanceof AiUnavailableError) return err
  const message = String((err as { message?: unknown })?.message ?? err)
  const m = message.toLowerCase()
  if ((err as { name?: string })?.name === 'AbortError' || (err as { name?: string })?.name === 'TimeoutError') {
    return new AiUnavailableError('timeout', 'AI request timed out')
  }
  // Quota first: a "429" can mean either rate limiting or the daily allowance.
  if (/daily|free allocation|neurons|quota|4006/.test(m)) return new AiUnavailableError('quota', message.slice(0, 200))
  if (/3040|capacity|busy|429|too many requests|overloaded/.test(m)) return new AiUnavailableError('busy', message.slice(0, 200))
  return new AiUnavailableError('error', message.slice(0, 200))
}

/** Rejects as soon as `signal` aborts, even if the underlying call never settles. */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new AiUnavailableError('timeout', 'AI request timed out'))
    if (signal.aborted) return onAbort()
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (v) => {
        signal.removeEventListener('abort', onAbort)
        resolve(v)
      },
      (e) => {
        signal.removeEventListener('abort', onAbort)
        reject(e)
      },
    )
  })
}

export class WorkersAiProvider implements AiProvider {
  readonly name = 'workers-ai'
  private readonly ai: AiBinding
  private readonly model: string

  constructor(ai: AiBinding, model: string = GEMMA_MODEL) {
    this.ai = ai
    this.model = model
  }

  async complete(request: AiRequest, signal?: AbortSignal): Promise<AiCompletion> {
    try {
      const out = await raceAbort(
        this.ai.run(
          this.model,
          {
            messages: [
              { role: 'system', content: request.system },
              { role: 'user', content: request.user },
            ],
            max_completion_tokens: request.maxTokens,
            temperature: request.temperature,
            response_format: { type: 'json_object' },
          },
          // Never wait in Cloudflare's capacity queue: if it is busy, fail fast and use the deterministic answer.
          { rejectIfBusy: true },
        ),
        signal,
      )
      const text = extractText(out)
      if (!text) throw new AiUnavailableError('error', 'AI returned no text')
      const usage = extractUsage(out)
      return { text, model: this.model, ...(usage ? { usage } : {}) }
    } catch (err) {
      throw classifyAiError(err)
    }
  }
}
