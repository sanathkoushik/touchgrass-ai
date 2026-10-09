const KEY = 'tg_session_id'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Used when browser storage is blocked (private mode): the session then lasts until the tab closes. */
let inMemory: string | null = null

/**
 * The anonymous session id sent as `X-Session-Id`. Created once per browser and kept in localStorage.
 * There are no accounts: this random id IS the identity, so it is never logged or shown.
 */
export function getSessionId(): string {
  try {
    const stored = localStorage.getItem(KEY)
    if (stored && UUID.test(stored)) return stored
    const fresh = crypto.randomUUID()
    localStorage.setItem(KEY, fresh)
    return fresh
  } catch {
    inMemory ??= crypto.randomUUID()
    return inMemory
  }
}

/** Forgets this browser's identity (used after the user deletes all their data). */
export function resetSession(): void {
  inMemory = null
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* storage unavailable: nothing to forget */
  }
}
