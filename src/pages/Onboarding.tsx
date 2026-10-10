import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ProfileInput } from '@/shared/api'
import type { Avoidance, Equipment, Goal, Motivator, SocialPreference } from '@/shared/engine/types'
import { AVOIDANCES, EQUIPMENT, GOALS, MOTIVATORS, SOCIAL_PREFERENCES } from '@/shared/engine/types'
import { ChoiceGroup } from '@/components/tg/ChoiceGroup'
import { PreferenceChip } from '@/components/tg/PreferenceChip'
import { PrimaryAction } from '@/components/tg/PrimaryAction'
import { Button } from '@/components/ui/button'
import { useProfile } from '@/hooks/useProfile'
import { ApiError, deleteProfile, getMissions, getProfile, saveProfile } from '@/lib/api'
import { clearCheckin } from '@/lib/checkin'
import { forgetAllPhotos } from '@/lib/photos'
import { clearPlace } from '@/lib/location'
import { clearMission, setProfileHint } from '@/lib/mission-store'
import {
  AVOIDANCE_LABELS,
  DURATION_CHOICES,
  EQUIPMENT_LABELS,
  GOAL_LABELS,
  INTERESTS,
  MOTIVATOR_LABELS,
  SOCIAL_LABELS,
  WINDOW_CHOICES,
} from '@/lib/vocab'

const toggle = <T,>(list: T[], item: T): T[] => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item])

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="font-display text-xl font-medium tracking-tight">{title}</legend>
      {hint && <p className="-mt-1 text-sm text-muted-foreground">{hint}</p>}
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  )
}

export default function Onboarding() {
  const navigate = useNavigate()
  const { state } = useProfile()
  const existing = state.status === 'ready'

  const [likes, setLikes] = useState<string[]>([])
  const [dislikes, setDislikes] = useState<string[]>([])
  const [duration, setDuration] = useState<number>(45)
  const [social, setSocial] = useState<SocialPreference>('any')
  const [motivators, setMotivators] = useState<Motivator[]>([])
  const [equipment, setEquipment] = useState<Equipment[]>([])
  const [avoidances, setAvoidances] = useState<Avoidance[]>([])
  const [windows, setWindows] = useState<string[]>([])
  const [goals, setGoals] = useState<Goal[]>([])

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [exporting, setExporting] = useState(false)

  // Pre-fill once from the saved profile; never overwrite what the person is typing.
  const prefilled = useRef(false)
  useEffect(() => {
    if (state.status !== 'ready' || prefilled.current) return
    prefilled.current = true
    const { preferences, motivators: m, equipment: e, avoidances: a, schedule_signals } = state.data.profile
    setLikes(preferences.likes)
    setDislikes(preferences.dislikes)
    setDuration(preferences.preferred_duration_min)
    setSocial(preferences.social_preference)
    setMotivators(m)
    setEquipment(e)
    setAvoidances(a)
    setWindows(schedule_signals.best_windows)
    setGoals(state.data.profile.goals ?? [])
  }, [state])

  // A thing cannot be both liked and disliked: choosing one side clears the other.
  const like = (term: string) => {
    setLikes((l) => toggle(l, term))
    setDislikes((d) => d.filter((x) => x !== term))
  }
  const dislike = (term: string) => {
    setDislikes((d) => toggle(d, term))
    setLikes((l) => l.filter((x) => x !== term))
  }

  async function save() {
    setSaving(true)
    setError(null)
    const input: ProfileInput = {
      preferences: { likes, dislikes, preferred_duration_min: duration, social_preference: social },
      motivators,
      avoidances,
      equipment,
      goals,
      best_windows: windows,
    }
    try {
      await saveProfile(input)
      setProfileHint(true)
      navigate('/plan')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save. Please try again.')
      setSaving(false)
    }
  }

  /** The person's own data, as a file: their preferences and every mission record. (Photos stay on the device, so they are not in it.) */
  async function downloadMyData() {
    setExporting(true)
    setError(null)
    try {
      const [profile, missions] = await Promise.all([getProfile(), getMissions(1000)])
      const file = { exported_at: new Date().toISOString(), note: 'Your TouchGrass AI data. Photos are kept only on your device and are not included.', profile: profile?.profile ?? null, missions: missions.records }
      const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = 'touchgrass-my-data.json'
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not prepare your data. Please try again.')
    } finally {
      setExporting(false)
    }
  }

  async function removeEverything() {
    setDeleting(true)
    setError(null)
    try {
      await deleteProfile()
      clearMission()
      clearPlace()
      clearCheckin()
      await forgetAllPhotos()
      setProfileHint(false)
      navigate('/')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete. Please try again.')
      setDeleting(false)
    }
  }

  const durationOptions = DURATION_CHOICES.map((d) => ({ value: d as number, label: `${d} min` }))
  const socialOptions = SOCIAL_PREFERENCES.map((s) => ({ value: s, label: SOCIAL_LABELS[s] }))

  return (
    <section className="space-y-9">
      <div>
        <h1 className="font-display text-3xl font-medium tracking-tight">{existing ? 'Your preferences' : 'Tell us what moves you'}</h1>
        <p className="mt-2 text-muted-foreground">
          Only things that change what we suggest. Skip anything you are unsure about. We learn the rest from what you actually do.
        </p>
      </div>

      <Section title="What do you enjoy?" hint="Pick any number.">
        {INTERESTS.map((i) => (
          <PreferenceChip key={i.term} selected={likes.includes(i.term)} onToggle={() => like(i.term)}>
            {i.label}
          </PreferenceChip>
        ))}
      </Section>

      <Section title="What would you rather skip?" hint="We will never suggest these.">
        {INTERESTS.map((i) => (
          <PreferenceChip key={i.term} selected={dislikes.includes(i.term)} onToggle={() => dislike(i.term)}>
            {i.label}
          </PreferenceChip>
        ))}
      </Section>

      <fieldset className="space-y-3">
        <legend className="font-display text-xl font-medium tracking-tight">How long do you usually have?</legend>
        <ChoiceGroup label="Usual time available" options={durationOptions} value={duration} onChange={setDuration} />
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="font-display text-xl font-medium tracking-tight">Who do you like to go with?</legend>
        <ChoiceGroup label="Company" options={socialOptions} value={social} onChange={setSocial} />
      </fieldset>

      <Section title="What do you want out of this?" hint="Optional. A nudge, never a rule: what you actually do counts more.">
        {GOALS.map((g) => (
          <PreferenceChip key={g} selected={goals.includes(g)} onToggle={() => setGoals((l) => toggle(l, g))}>
            {GOAL_LABELS[g]}
          </PreferenceChip>
        ))}
      </Section>

      <Section title="What makes you want to go?" hint="The reasons that would actually get you off the sofa.">
        {MOTIVATORS.map((m) => (
          <PreferenceChip key={m} selected={motivators.includes(m)} onToggle={() => setMotivators((l) => toggle(l, m))}>
            {MOTIVATOR_LABELS[m].label}
          </PreferenceChip>
        ))}
      </Section>

      <Section title="What do you have?" hint="We only suggest what you can do today.">
        {EQUIPMENT.map((e) => (
          <PreferenceChip key={e} selected={equipment.includes(e)} onToggle={() => setEquipment((l) => toggle(l, e))}>
            {EQUIPMENT_LABELS[e]}
          </PreferenceChip>
        ))}
      </Section>

      <Section title="When are you usually free?">
        {WINDOW_CHOICES.map((w) => (
          <PreferenceChip key={w.window} selected={windows.includes(w.window)} onToggle={() => setWindows((l) => toggle(l, w.window))}>
            {w.label}
          </PreferenceChip>
        ))}
      </Section>

      <Section title="Anything to avoid?">
        {AVOIDANCES.map((a) => (
          <PreferenceChip key={a} selected={avoidances.includes(a)} onToggle={() => setAvoidances((l) => toggle(l, a))}>
            {AVOIDANCE_LABELS[a]}
          </PreferenceChip>
        ))}
      </Section>

      {error && (
        <p role="alert" className="rounded-xl border border-destructive/40 bg-card px-4 py-3 text-sm">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <PrimaryAction onClick={() => void save()} isLoading={saving} loadingText="Saving…">
          {existing ? 'Save changes' : 'Save and find my first mission'}
        </PrimaryAction>
      </div>

      {existing && (
        <div className="space-y-3 border-t pt-6">
          <h2 className="font-display text-lg font-medium">Your data</h2>
          <p className="text-sm text-muted-foreground">
            Everything we know about you is what you entered here and what you told us after each mission. What we have guessed from it is on your meadow page, where you can correct it or start again.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void downloadMyData()} disabled={exporting}>
              {exporting ? 'Preparing…' : 'Download my data'}
            </Button>
            {!confirmDelete && (
              <Button variant="outline" onClick={() => setConfirmDelete(true)}>
                Delete my data
              </Button>
            )}
          </div>
          {confirmDelete && (
            <div role="alertdialog" aria-label="Confirm deletion" className="space-y-3 rounded-xl border border-destructive/40 bg-card p-4">
              <p className="text-sm">This permanently removes your preferences and your whole history. It cannot be undone.</p>
              <div className="flex gap-2">
                <Button variant="destructive" onClick={() => void removeEverything()} disabled={deleting}>
                  {deleting ? 'Deleting…' : 'Yes, delete everything'}
                </Button>
                <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                  Keep my data
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
