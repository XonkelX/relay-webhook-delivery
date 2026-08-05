import { z } from 'zod'
import { DeliveryIdSchema } from './ids'

export const DeliveryStatusSchema = z.enum([
  'queued',
  'leased',
  'retrying',
  'delivered',
  'exhausted',
  'cancelled',
])

export const AttemptOutcomeSchema = z.enum([
  'success',
  'transient_failure',
  'permanent_failure',
  'timeout',
  'network_error',
])

export const DeliveryQueueReasonSchema = z.enum(['initial', 'retry', 'replay'])

export const DeliveryQueueMessageSchema = z.strictObject({
  version: z.literal(1),
  deliveryId: DeliveryIdSchema,
  reason: DeliveryQueueReasonSchema,
})

export type DeliveryStatus = z.infer<typeof DeliveryStatusSchema>
export type AttemptOutcome = z.infer<typeof AttemptOutcomeSchema>
export type DeliveryQueueReason = z.infer<typeof DeliveryQueueReasonSchema>
export type DeliveryQueueMessage = z.infer<typeof DeliveryQueueMessageSchema>
