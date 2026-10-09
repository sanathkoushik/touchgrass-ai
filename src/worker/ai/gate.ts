import type { AiOutcomeStatus } from './refine'

const DAY_MS = 86_400_000

/**
 * A simple circuit breaker, so a quota or capacity problem does not slow down every request.
 * After a failure we skip the AI for a while and answer with the deterministic engine straight away.
 *
 * It lives in the Worker instance's memory, so each instance learns on its own. That is fine here:
 * the worst case is one wasted AI attempt per instance per window.
 */
export class AiGate {
  private blockedUntil = 0

  canTry(nowMs: number): boolean {
    return nowMs >= this.blockedUntil
  }

  record(status: AiOutcomeStatus, nowMs: number): void {
    switch (status) {
      case 'quota':
        // The free allowance resets at 00:00 UTC.
        this.blockedUntil = (Math.floor(nowMs / DAY_MS) + 1) * DAY_MS
        break
      case 'busy':
        this.blockedUntil = nowMs + 30_000
        break
      case 'timeout':
      case 'error':
        this.blockedUntil = nowMs + 10_000
        break
      case 'ok':
        this.blockedUntil = 0
        break
      // 'invalid' is a model-quality problem, not an availability one; 'skipped' never called the AI.
      default:
        break
    }
  }

  /** For logs and tests. */
  get blockedUntilMs(): number {
    return this.blockedUntil
  }
}
