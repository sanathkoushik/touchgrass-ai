import { useState } from 'react'
import { Check, Minus, X, Cloud, Users } from 'lucide-react'
import { PreferenceChip } from '@/components/tg/PreferenceChip'
import { FeedbackButton } from '@/components/tg/FeedbackButton'
import { ContextPill } from '@/components/tg/ContextPill'
import { MissionCard } from '@/components/tg/MissionCard'
import { PrimaryAction } from '@/components/tg/PrimaryAction'

/** Dev-only component sandbox. Labels are UI-demo strings, not product data. Not included in production builds. */
export default function DevUi() {
  const [chips, setChips] = useState<string[]>([])
  const [outcome, setOutcome] = useState<string>()
  const [busy, setBusy] = useState(false)
  const toggle = (c: string) =>
    setChips((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]))

  return (
    <section className="space-y-8">
      <h1 className="text-2xl font-semibold">UI sandbox (dev only)</h1>
      <MissionCard
        title="Sample card layout"
        reason="Demonstrates the card with all slots filled."
        firstStep="Placeholder first step text."
        meta={
          <>
            <ContextPill icon={Cloud}>Pill</ContextPill>
            <ContextPill icon={Users}>Pill</ContextPill>
          </>
        }
        actions={
          <PrimaryAction
            isLoading={busy}
            loadingText="Thinking…"
            onClick={() => {
              setBusy(true)
              setTimeout(() => setBusy(false), 2000)
            }}
          >
            Plan my next hour
          </PrimaryAction>
        }
      />
      <div className="flex flex-wrap gap-2">
        {['Chip A', 'Chip B', 'Chip C'].map((c) => (
          <PreferenceChip key={c} selected={chips.includes(c)} onToggle={() => toggle(c)}>
            {c}
          </PreferenceChip>
        ))}
      </div>
      <div className="flex gap-3">
        <FeedbackButton icon={Check} selected={outcome === 'a'} onClick={() => setOutcome('a')}>
          Did it
        </FeedbackButton>
        <FeedbackButton icon={Minus} selected={outcome === 'b'} onClick={() => setOutcome('b')}>
          Part
        </FeedbackButton>
        <FeedbackButton icon={X} selected={outcome === 'c'} onClick={() => setOutcome('c')}>
          Skipped
        </FeedbackButton>
      </div>
    </section>
  )
}
