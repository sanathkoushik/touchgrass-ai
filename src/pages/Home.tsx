import { lazy, Suspense, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DockNav } from '@/components/DockNav'
import { PrimaryAction } from '@/components/tg/PrimaryAction'
import { ScrollBasedVelocity } from '@/components/ui/scroll-based-velocity'
import { getProfile } from '@/lib/api'
import { hasProfileHint, setProfileHint } from '@/lib/mission-store'

// Loaded after first paint: the headline and button never wait for the photos.
const InfiniteImageField = lazy(() =>
  import('@/components/ui/infinite-image-field').then((m) => ({ default: m.InfiniteImageField })),
)

const TICKER =
  'Touch grass — Go outside — Feel the sun on your face — Phone down, head up — Chase the golden hour — One more block — Walk it off — Say yes to the park — '

/**
 * First screen. Three quarters of the viewport is a drifting field of real outdoor photographs
 * with the pitch on top; the last quarter holds two counter-moving lines of text and the dock.
 */
export default function Home() {
  const navigate = useNavigate()
  const [compact] = useState(() => window.matchMedia('(max-width: 639px)').matches)
  // The button is right straight away from a cached hint; the server then confirms in the background.
  const [hasProfile, setHasProfile] = useState(hasProfileHint)
  useEffect(() => {
    const ac = new AbortController()
    getProfile(ac.signal)
      .then((p) => {
        setProfileHint(p !== null)
        setHasProfile(p !== null)
      })
      .catch(() => {})
    return () => ac.abort()
  }, [])

  // While the person reads the headline, quietly fetch the page the button leads to, so tapping it is instant.
  // Skipped on "data saver", and it waits a moment so it never competes with the first paint.
  useEffect(() => {
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData
    if (saveData) return
    const prefetch = () => void (hasProfile ? import('@/pages/Plan') : import('@/pages/Onboarding'))
    // A short delay (not requestIdleCallback: Safari lacks it) keeps this out of the first paint.
    const id = window.setTimeout(prefetch, 2000)
    return () => window.clearTimeout(id)
  }, [hasProfile])

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-background">
      {/* ---- top 3/4: photo field + hero ---- */}
      <section className="relative isolate flex basis-3/4 items-center justify-center overflow-hidden">
        <div aria-hidden="true" className="absolute inset-0 -z-20">
          <Suspense fallback={null}>
            <InfiniteImageField
              imageWidth={compact ? 120 : 190}
              imageHeight={compact ? 168 : 266}
              gap={compact ? 16 : 26}
              borderRadius={14}
              maxSpeed={4}
            />
          </Suspense>
        </div>
        {/* Readability scrim: the pitch never depends on the photos or the animation */}
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,color-mix(in_oklch,var(--background)_90%,transparent)_0%,color-mix(in_oklch,var(--background)_74%,transparent)_52%,color-mix(in_oklch,var(--background)_50%,transparent)_100%)]"
        />
        {/* Melts the photos into the strip below instead of a hard edge */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 -z-10 h-24 bg-gradient-to-t from-background to-transparent"
        />

        <main className="mx-auto max-w-2xl px-6 text-center">
          <p className="text-xs font-medium tracking-[0.25em] text-primary uppercase">TouchGrass AI</p>
          <h1 className="font-display mt-4 text-5xl leading-[1.05] font-medium tracking-tight text-balance sm:text-7xl">
            It learns what gets you <span className="text-primary">outside.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-md text-base text-balance text-muted-foreground sm:text-lg">
            One real-world mission at a time, picked for you. Then you put the phone down.
          </p>
          <div className="mt-8 flex justify-center">
            <PrimaryAction onClick={() => navigate(hasProfile ? '/plan' : '/onboarding')}>
              {hasProfile ? 'Plan my next hour' : 'Get started'}
            </PrimaryAction>
          </div>
        </main>
      </section>

      {/* ---- bottom 1/4: dock on top, one slow line of text along the very bottom (separate rows: no overlap) ---- */}
      <section className="relative z-10 flex min-h-[9.5rem] basis-1/4 flex-col justify-end">
        <div className="relative z-10 pb-2">
          <DockNav inline />
        </div>
        <div
          className="pointer-events-none mb-3 flex h-14 shrink-0 items-center overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]"
        >
          <div className="w-full text-[clamp(1.5rem,5.6svh,3rem)] leading-[1.1]">
            <ScrollBasedVelocity
              text={TICKER}
              pixelsPerSecond={65}
              className="font-display font-medium tracking-tight text-foreground/80"
            />
          </div>
        </div>
      </section>
    </div>
  )
}
