import { z } from 'zod'
import { locationSchema } from './context'

export const nearbyInputSchema = z.strictObject({
  location: locationSchema,
  activity_id: z.string().trim().min(1).max(60),
})
