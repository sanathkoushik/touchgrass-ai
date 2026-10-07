import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <section className="space-y-2">
      <h1 className="font-display text-3xl font-medium tracking-tight">Nothing here</h1>
      <Link to="/" className="text-primary underline underline-offset-4">
        Back home
      </Link>
    </section>
  )
}
