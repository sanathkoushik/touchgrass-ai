import { useCallback, useEffect, useState } from 'react'
import type { ProfileResponse } from '@/shared/api'
import { ApiError, getProfile } from '@/lib/api'
import { setProfileHint } from '@/lib/mission-store'

export type ProfileState =
  | { status: 'loading' }
  | { status: 'none' }
  | { status: 'ready'; data: ProfileResponse }
  | { status: 'error'; error: ApiError }

/**
 * Loads the profile in the background. The screen that uses it must render something useful
 * while this is still `loading`: nothing is allowed to wait for it.
 */
export function useProfile() {
  const [state, setState] = useState<ProfileState>({ status: 'loading' })
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    const ac = new AbortController()
    getProfile(ac.signal)
      .then((data) => {
        setProfileHint(data !== null)
        setState(data ? { status: 'ready', data } : { status: 'none' })
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.code === 'cancelled') return
        setState({ status: 'error', error: err instanceof ApiError ? err : new ApiError(0, 'network', 'Could not load your profile.') })
      })
    return () => ac.abort()
  }, [nonce])

  const refresh = useCallback(() => {
    setState({ status: 'loading' })
    setNonce((n) => n + 1)
  }, [])

  return { state, refresh }
}
