import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { getProfile, patchProfile } from '@/lib/api'

type Props = {
  activity: { activity_id: string; title: string }
}

/** "You would not repeat this": offer to stop suggesting it altogether, or just leave it to be suggested less. Their choice. */
export function AvoidPrompt({ activity }: Props) {
  const [state, setState] = useState<'ask' | 'avoided' | 'less' | 'error'>('ask')
  const [busy, setBusy] = useState(false)

  async function avoid() {
    setBusy(true)
    try {
      const current = (await getProfile())?.profile.avoid_activities ?? []
      await patchProfile({ avoid_activities: [...new Set([...current, activity.activity_id])] })
      setState('avoided')
    } catch {
      setState('error')
    } finally {
      setBusy(false)
    }
  }

  if (state === 'avoided') return <p className="rounded-2xl border bg-card p-4 text-sm">Done. We will not suggest {activity.title} again. You can change your mind any time in your meadow.</p>
  if (state === 'less') return <p className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">Okay. We will suggest it less often, and leave it in the mix.</p>

  return (
    <div className="space-y-3 rounded-2xl border bg-card p-4">
      <p className="text-sm">
        You said you would not really want to do <strong className="font-medium">{activity.title}</strong> again. Should we stop suggesting it?
      </p>
      {state === 'error' && <p className="text-sm text-muted-foreground">That did not save. You can try again, or manage it from your meadow later.</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void avoid()} disabled={busy}>
          Yes, stop suggesting it
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setState('less')} disabled={busy}>
          Just suggest it less
        </Button>
      </div>
    </div>
  )
}
