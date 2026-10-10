import { useLocation, useNavigate } from 'react-router-dom'
import { Compass, Flower2, Home, ListChecks, Sprout } from 'lucide-react'
import { MagneticDock } from '@/components/ui/magnetic-dock'
import { cn } from '@/lib/utils'

const routes = [
  { id: 'home', to: '/', label: 'Home', Icon: Home },
  { id: 'plan', to: '/plan', label: 'Plan', Icon: Compass },
  { id: 'feedback', to: '/feedback', label: 'How it went', Icon: ListChecks },
  { id: 'history', to: '/history', label: 'Your meadow', Icon: Flower2 },
  { id: 'onboarding', to: '/onboarding', label: 'Preferences', Icon: Sprout },
]

type Props = {
  /** Render in normal flow (e.g. inside the Home hero strip) instead of floating at the bottom of the viewport. */
  inline?: boolean
}

/** App-wide navigation: the magnetic dock. */
export function DockNav({ inline = false }: Props) {
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
    <nav
      aria-label="Primary"
      className={cn(
        'pointer-events-none z-30 flex justify-center',
        inline ? 'relative' : 'fixed inset-x-0 bottom-4',
      )}
    >
      <div className="pointer-events-auto">
        <MagneticDock items={items} iconSize={44} maxScale={1.35} magneticDistance={110} />
      </div>
    </nav>
  )
}
