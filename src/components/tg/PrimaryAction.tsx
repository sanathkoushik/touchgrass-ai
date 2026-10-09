import type { ComponentProps } from 'react'
import { HaloButton } from '@/components/ui/halo-button'

/**
 * The one dominant "Go" action on a screen. Thin wrapper so the underlying effect can change in one place.
 *
 * HaloButton animates its label letter by letter (one <span> per character), which some screen readers
 * announce badly. So when the label is plain text we also set it as the button's single accessible name,
 * and keep it in step with the loading text.
 */
export function PrimaryAction(props: ComponentProps<typeof HaloButton>) {
  const { children, isLoading, loadingText, 'aria-label': explicit, ...rest } = props
  const visible = isLoading ? (loadingText ?? 'Working…') : children
  const accessibleName = explicit ?? (typeof visible === 'string' ? visible : undefined)
  return (
    <HaloButton {...rest} isLoading={isLoading} loadingText={loadingText} aria-label={accessibleName}>
      {children}
    </HaloButton>
  )
}
