import { useState } from 'react'
import { FEELINGS, HELPERS, SKIP_REASONS, WOULD_REPEAT, type Feeling, type Helper, type SkipReason, type WouldRepeat } from '@/shared/engine/types'
import { Button } from '@/components/ui/button'
import { FEELING_LABELS, HELPER_LABELS, SKIP_REASON_LABELS, WOULD_REPEAT_LABELS } from '@/lib/vocab'
import { PreferenceChip } from './PreferenceChip'

/** The three short questions. We ask ONE per mission (rotating), so coming back is never a survey. */
export const REFLECTION_QUESTIONS = ['feeling', 'easier_harder', 'repeat'] as const
export type ReflectionQuestion = (typeof REFLECTION_QUESTIONS)[number]

/** FNV-1a: a stable pick from the mission id, so the same mission always asks the same question and different ones rotate. */
function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

export function questionFor(missionId: string): ReflectionQuestion {
  return REFLECTION_QUESTIONS[hash(missionId) % REFLECTION_QUESTIONS.length]!
}

type Props = {
  missionId: string
  feeling: Feeling | null
  onFeeling: (f: Feeling | null) => void
  helper: Helper | null
  onHelper: (h: Helper | null) => void
  barrier: SkipReason | null
  onBarrier: (b: SkipReason | null) => void
  wouldRepeat: WouldRepeat | null
  onWouldRepeat: (w: WouldRepeat | null) => void
  disabled?: boolean
}

const Q = ({ children }: { children: string }) => <p className="text-sm font-medium">{children}</p>
const Optional = () => <span className="font-normal text-muted-foreground"> (optional)</span>

/** A barrier on a mission that happened is "what made it harder": skip reasons minus the ones that only make sense for not going. */
const HARDER = SKIP_REASONS.filter((r) => r !== 'other' && r !== 'no_friend' && r !== 'too_costly')

export function ReflectionQuestions(p: Props) {
  const [all, setAll] = useState(false)
  const primary = questionFor(p.missionId)
  const show = (q: ReflectionQuestion) => all || q === primary

  const toggle = <T,>(current: T | null, value: T, set: (v: T | null) => void) => set(current === value ? null : value)

  return (
    <div className="space-y-5">
      {show('feeling') && (
        <div className="space-y-2">
          <Q>How do you feel now compared with before?</Q>
          <div className="flex flex-wrap gap-2" role="group" aria-label="How you feel now">
            {FEELINGS.map((f) => (
              <PreferenceChip key={f} selected={p.feeling === f} onToggle={() => toggle(p.feeling, f, p.onFeeling)} disabled={p.disabled}>
                {FEELING_LABELS[f]}
              </PreferenceChip>
            ))}
          </div>
        </div>
      )}

      {show('easier_harder') && (
        <div className="space-y-3">
          <div className="space-y-2">
            <Q>What made it easier?</Q>
            <div className="flex flex-wrap gap-2" role="group" aria-label="What made it easier">
              {HELPERS.map((h) => (
                <PreferenceChip key={h} selected={p.helper === h} onToggle={() => toggle(p.helper, h, p.onHelper)} disabled={p.disabled}>
                  {HELPER_LABELS[h]}
                </PreferenceChip>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">
              And what made it harder?
              <Optional />
            </p>
            <div className="flex flex-wrap gap-2" role="group" aria-label="What made it harder">
              {HARDER.map((r) => (
                <PreferenceChip key={r} selected={p.barrier === r} onToggle={() => toggle(p.barrier, r, p.onBarrier)} disabled={p.disabled}>
                  {SKIP_REASON_LABELS[r]}
                </PreferenceChip>
              ))}
            </div>
          </div>
        </div>
      )}

      {show('repeat') && (
        <div className="space-y-2">
          <Q>Would you want to do something like this again?</Q>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Would you do it again">
            {WOULD_REPEAT.map((w) => (
              <PreferenceChip key={w} selected={p.wouldRepeat === w} onToggle={() => toggle(p.wouldRepeat, w, p.onWouldRepeat)} disabled={p.disabled}>
                {WOULD_REPEAT_LABELS[w]}
              </PreferenceChip>
            ))}
          </div>
        </div>
      )}

      {!all && (
        <Button variant="ghost" size="sm" onClick={() => setAll(true)}>
          Answer the others too
        </Button>
      )}
    </div>
  )
}
