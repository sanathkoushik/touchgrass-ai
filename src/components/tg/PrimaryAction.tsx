import type { ComponentProps } from 'react'
import { HaloButton } from '@/components/ui/halo-button'

/** The one dominant "Go" action on a screen. Thin wrapper so the underlying effect can change in one place. */
export function PrimaryAction(props: ComponentProps<typeof HaloButton>) {
  return <HaloButton {...props} />
}
