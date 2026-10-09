import { cn } from '@/lib/utils'

type Props<T extends string | number> = {
  /** Accessible name for the whole group, e.g. "How long do you usually have?" */
  label: string
  options: readonly { value: T; label: string; hint?: string }[]
  value: T | undefined
  onChange: (value: T) => void
  disabled?: boolean
  className?: string
}

/** Pick exactly one. Rendered as large, tactile pills; announced to screen readers as a radio group. */
export function ChoiceGroup<T extends string | number>({ label, options, value, onChange, disabled, className }: Props<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('flex flex-wrap gap-2', className)}>
      {options.map((o) => {
        const selected = o.value === value
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              'rounded-xl border px-4 py-2.5 text-left text-sm transition-all outline-none',
              'focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] disabled:opacity-50',
              selected
                ? 'border-primary/60 bg-primary/15 text-foreground shadow-[0_0_0_1px_var(--primary)_inset]'
                : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <span className="block font-medium">{o.label}</span>
            {o.hint && <span className={cn('block text-xs', selected ? 'text-foreground/85' : 'text-muted-foreground')}>{o.hint}</span>}
          </button>
        )
      })}
    </div>
  )
}
