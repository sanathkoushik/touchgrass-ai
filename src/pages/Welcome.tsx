import { lazy, Suspense, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PrimaryAction } from '@/components/tg/PrimaryAction'
import { markWelcomeSeen } from '@/lib/welcome'

// Heavy-ish visual: loaded after first paint, never blocks the headline or the button.
const InfiniteImageField = lazy(() =>
  import('@/components/ui/infinite-image-field').then((m) => ({ default: m.InfiniteImageField })),
)

export default function Welcome() {
  const navigate = useNavigate()
  const [small] = useState(() => window.matchMedia('(max-width: 639px)').matches)

  return (
    <div className="relative isolate flex min-h-svh items-center justify-center overflow-hidden bg-background">
      <div aria-hidden="true" className="absolute inset-0 -z-20">
        <Suspense fallback={null}>
          <InfiniteImageField
            imageWidth={small ? 130 : 200}
            imageHeight={small ? 182 : 280}
            gap={small ? 18 : 28}
            borderRadius={14}
            maxSpeed={4}
          />
        </Suspense>
      </div>
      {/* Readability scrim: text never depends on the photos or the animation */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,color-mix(in_oklch,var(--background)_88%,transparent)_0%,color-mix(in_oklch,var(--background)_72%,transparent)_55%,color-mix(in_oklch,var(--background)_55%,transparent)_100%)]"
      />
      <main className="mx-auto max-w-xl px-6 text-center">
        <p className="text-sm font-medium tracking-[0.2em] text-primary uppercase">TouchGrass AI</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
          It learns what gets you outside.
        </h1>
        <p className="mx-auto mt-5 max-w-md text-balance text-muted-foreground">
          One real-world mission at a time, picked for you, at the right moment. Then you put the phone down.
        </p>
        <div className="mt-8 flex flex-col items-center gap-4">
          <PrimaryAction
            onClick={() => {
              markWelcomeSeen()
              navigate('/onboarding')
            }}
          >
            Get started
          </PrimaryAction>
          <Link
            to="/"
            onClick={markWelcomeSeen}
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Skip intro
          </Link>
        </div>
      </main>
    </div>
  )
}
