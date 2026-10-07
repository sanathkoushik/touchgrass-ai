import { Navigate } from 'react-router-dom'
import { hasSeenWelcome } from '@/lib/welcome'
import { Clock } from 'lucide-react'
import { MissionCard } from '@/components/tg/MissionCard'
import { PrimaryAction } from '@/components/tg/PrimaryAction'
import { ContextPill } from '@/components/tg/ContextPill'

export default function Home() {
  if (!hasSeenWelcome()) return <Navigate to="/welcome" replace />
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Ready to touch grass?</h1>
        <p className="mt-2 text-muted-foreground">
          One real-world mission, picked for you. Then leave the screen.
        </p>
      </div>
      <MissionCard
        title="Your next mission will appear here"
        reason="Tell us what moves you, then tap the button. We'll pick one thing worth leaving the screen for."
        meta={<ContextPill icon={Clock}>Next hour</ContextPill>}
        actions={<PrimaryAction disabled>Plan my next hour</PrimaryAction>}
      />
    </section>
  )
}
