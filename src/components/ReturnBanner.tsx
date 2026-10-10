import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Footprints } from 'lucide-react'
import { awayText } from '@/lib/away'
import { Button } from '@/components/ui/button'
import { loadMission, minutesAway } from '@/lib/mission-store'

/** The pages that already deal with a mission in progress. */
const OWN_PAGES = ['/plan', '/feedback']

/**
 * If the person set off on a mission and has not reported back, a quiet note on every other page makes coming back
 * one tap. It never nags (no pop-ups, no sounds) and it is not shown on the pages that already cover the mission.
 */
export function ReturnBanner() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [away, setAway] = useState<{ title: string; text: string | null } | null>(null)

  useEffect(() => {
    const read = () => {
      const m = loadMission()
      setAway(m?.stage === 'going' ? { title: m.recommendation.title, text: awayText(minutesAway(m)) } : null)
    }
    read()
    const id = window.setInterval(read, 60_000)
    document.addEventListener('visibilitychange', read)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', read)
    }
  }, [pathname])

  if (!away || OWN_PAGES.some((p) => pathname.startsWith(p))) return null

  return (
    <div role="status" className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-primary/40 bg-primary/10 px-4 py-3">
      <Footprints className="size-5 shrink-0 text-primary" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-sm">
        <span className="font-medium">{away.title}</span>
        <span className="text-muted-foreground"> {away.text ? `${away.text} ` : ''}Back already?</span>
      </p>
      <Button size="sm" onClick={() => navigate('/feedback')}>
        I am back
      </Button>
    </div>
  )
}
