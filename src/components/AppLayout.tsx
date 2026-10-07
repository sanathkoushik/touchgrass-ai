import { Outlet } from 'react-router-dom'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { DockNav } from '@/components/DockNav'

export function AppLayout() {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center px-4">
          <span className="font-display text-lg font-semibold tracking-tight">
            Touch<span className="text-primary">Grass</span> AI
          </span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-8 pb-32">
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>
      <DockNav />
    </div>
  )
}
