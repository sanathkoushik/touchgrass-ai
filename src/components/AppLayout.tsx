import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { History, Home, ListChecks, Sprout } from 'lucide-react'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { MagneticDock } from '@/components/ui/magnetic-dock'

const routes = [
  { id: 'home', to: '/', label: 'Home', Icon: Home },
  { id: 'onboarding', to: '/onboarding', label: 'Preferences', Icon: Sprout },
  { id: 'feedback', to: '/feedback', label: 'Feedback', Icon: ListChecks },
  { id: 'history', to: '/history', label: 'History', Icon: History },
]

export function AppLayout() {
  const { pathname } = useLocation()
  const navigate = useNavigate()

  const items = routes.map(({ id, to, label, Icon }) => ({
    id,
    label,
    icon: <Icon className="size-full" strokeWidth={1.75} />,
    isActive: to === '/' ? pathname === '/' : pathname.startsWith(to),
    onClick: () => navigate(to),
  }))

  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center px-4">
          <span className="font-semibold tracking-tight">
            Touch<span className="text-primary">Grass</span> AI
          </span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-8 pb-32">
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>
      <nav
        aria-label="Primary"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-20 flex justify-center"
      >
        <div className="pointer-events-auto">
          <MagneticDock items={items} iconSize={44} maxScale={1.35} magneticDistance={110} />
        </div>
      </nav>
    </div>
  )
}
