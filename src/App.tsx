import { lazy, Suspense } from 'react'
import { LazyMotion } from 'motion/react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/components/AppLayout'
import Home from '@/pages/Home'

// Only the first screen is in the main bundle. The other pages download when first visited.
const Onboarding = lazy(() => import('@/pages/Onboarding'))
const Plan = lazy(() => import('@/pages/Plan'))
const Feedback = lazy(() => import('@/pages/Feedback'))
const History = lazy(() => import('@/pages/History'))
const NotFound = lazy(() => import('@/pages/NotFound'))
const loadMotionFeatures = () => import('@/lib/motion-features').then((m) => m.default)

const DevUi = import.meta.env.DEV ? lazy(() => import('@/pages/DevUi')) : null

export default function App() {
  return (
    <LazyMotion features={loadMotionFeatures}>
    <BrowserRouter>
      <Routes>
        {/* Full-bleed hero: manages its own layout and dock */}
        <Route path="/" element={<Home />} />
        <Route path="welcome" element={<Navigate to="/" replace />} />
        <Route element={<AppLayout />}>
          <Route path="onboarding" element={<Onboarding />} />
          <Route path="plan" element={<Plan />} />
          <Route path="feedback" element={<Feedback />} />
          <Route path="history" element={<History />} />
          {DevUi && (
            <Route
              path="dev/ui"
              element={
                <Suspense fallback={null}>
                  <DevUi />
                </Suspense>
              }
            />
          )}
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
    </LazyMotion>
  )
}
