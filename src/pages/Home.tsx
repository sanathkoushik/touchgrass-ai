import { Button } from '@/components/ui/button'

export default function Home() {
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Ready to touch grass?</h1>
        <p className="mt-2 text-muted-foreground">
          One real-world mission, picked for you. Then leave the screen.
        </p>
      </div>
      <div className="rounded-xl border bg-card p-6">
        <p className="text-sm text-muted-foreground">Your mission will appear here.</p>
        <Button className="mt-4" disabled>
          Plan my next hour
        </Button>
      </div>
    </section>
  )
}
