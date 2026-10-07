import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/components/AppLayout'
import Home from '@/pages/Home'
import Onboarding from '@/pages/Onboarding'
import Feedback from '@/pages/Feedback'
import History from '@/pages/History'
import NotFound from '@/pages/NotFound'
import Welcome from '@/pages/Welcome'

const DevUi = import.meta.env.DEV ? lazy(() => import('@/pages/DevUi')) : null

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="welcome" element={<Welcome />} />
        <Route element={<AppLayout />}>
          <Route index element={<Home />} />
          <Route path="onboarding" element={<Onboarding />} />
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
  )
}
