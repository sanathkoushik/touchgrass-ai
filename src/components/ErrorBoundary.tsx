import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

type Props = { children: ReactNode }
type State = { hasError: boolean }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI error caught by boundary:', error, info.componentStack)
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div role="alert" className="mx-auto max-w-md p-8 text-center">
        <h2 className="text-lg font-semibold">Something hiccuped.</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This part of the app failed to load. The rest still works.
        </p>
        <Button className="mt-4" onClick={() => this.setState({ hasError: false })}>
          Try again
        </Button>
      </div>
    )
  }
}
