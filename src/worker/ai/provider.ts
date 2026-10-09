/**
 * The only thing the rest of the app knows about "an AI". Swapping Workers AI for another provider
 * (Groq, OpenRouter, a local Ollama...) means writing one class that implements `AiProvider`.
 */

export interface AiRequest {
  system: string
  user: string
  maxTokens: number
  temperature: number
}

export interface AiCompletion {
  text: string
  model: string
  usage?: { inputTokens: number; outputTokens: number }
}

/**
 *  busy    - provider has no capacity right now (do not queue; fall back immediately)
 *  quota   - the free daily allowance is used up
 *  timeout - no answer within our time budget
 *  error   - anything else
 */
export type AiFailureKind = 'busy' | 'quota' | 'timeout' | 'error'

export class AiUnavailableError extends Error {
  readonly kind: AiFailureKind

  constructor(kind: AiFailureKind, message: string) {
    super(message)
    this.name = 'AiUnavailableError'
    this.kind = kind
  }
}

export interface AiProvider {
  readonly name: string
  /** Rejects with `AiUnavailableError` for every expected failure. */
  complete(request: AiRequest, signal?: AbortSignal): Promise<AiCompletion>
}
