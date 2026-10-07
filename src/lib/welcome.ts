const WELCOME_SEEN_KEY = 'tg_welcome_seen'

export function hasSeenWelcome(): boolean {
  try {
    return localStorage.getItem(WELCOME_SEEN_KEY) === '1'
  } catch {
    return true // storage blocked: never trap the user in a redirect loop
  }
}

export function markWelcomeSeen(): void {
  try {
    localStorage.setItem(WELCOME_SEEN_KEY, '1')
  } catch {
    /* storage unavailable (private mode): the welcome simply shows again */
  }
}
