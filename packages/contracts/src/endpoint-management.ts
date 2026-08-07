import { z } from 'zod'
import { EndpointIdSchema } from './ids.js'
import { EventTypeSchema } from './ingestion.js'

const TimestampSchema = z.string().min(1).max(64)

export const OwnerEndpointStatusTargetSchema = z.enum(['active', 'paused'])

export const OwnerEndpointStatusUpdateRequestSchema = z.strictObject({
  status: OwnerEndpointStatusTargetSchema,
})

export const OwnerEndpointStatusUpdateResponseSchema = z.strictObject({
  endpointId: EndpointIdSchema,
  status: OwnerEndpointStatusTargetSchema,
  updatedAt: TimestampSchema,
  changed: z.boolean(),
})

export const OwnerEndpointSubscriptionsUpdateRequestSchema = z.strictObject({
  eventTypes: z.array(EventTypeSchema).max(100),
})

export const OwnerEndpointSubscriptionsUpdateResponseSchema = z.strictObject({
  endpointId: EndpointIdSchema,
  subscriptions: z.array(EventTypeSchema),
})

export const OwnerEndpointVerificationResponseSchema = z.strictObject({
  endpointId: EndpointIdSchema,
  status: z.literal('active'),
  verifiedAt: TimestampSchema,
})

export const OwnerEndpointSecretRotationResponseSchema = z.strictObject({
  endpointId: EndpointIdSchema,
  signingSecret: z.string().min(1).max(256),
  generation: z.number().int().positive(),
  rotatedAt: TimestampSchema,
  previousSecretValidUntil: TimestampSchema,
})

export type OwnerEndpointStatusTarget = z.infer<typeof OwnerEndpointStatusTargetSchema>

export type OwnerEndpointStatusUpdateRequest = z.infer<
  typeof OwnerEndpointStatusUpdateRequestSchema
>

export type OwnerEndpointStatusUpdateResponse = z.infer<
  typeof OwnerEndpointStatusUpdateResponseSchema
>

export type OwnerEndpointSubscriptionsUpdateRequest = z.infer<
  typeof OwnerEndpointSubscriptionsUpdateRequestSchema
>

export type OwnerEndpointSubscriptionsUpdateResponse = z.infer<
  typeof OwnerEndpointSubscriptionsUpdateResponseSchema
>

export type OwnerEndpointVerificationResponse = z.infer<
  typeof OwnerEndpointVerificationResponseSchema
>

export type OwnerEndpointSecretRotationResponse = z.infer<
  typeof OwnerEndpointSecretRotationResponseSchema
>
