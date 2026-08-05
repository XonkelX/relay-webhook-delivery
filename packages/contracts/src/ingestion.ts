import { z } from 'zod'
import { EventIdSchema } from './ids'

export const MAX_EVENT_PAYLOAD_BYTES = 256 * 1024
export const MAX_IDEMPOTENCY_KEY_LENGTH = 200

export const EventTypeSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(
    /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/,
    'Event type must use lowercase segments separated by dots, hyphens, or underscores',
  )

export const IdempotencyKeySchema = z.string().trim().min(1).max(MAX_IDEMPOTENCY_KEY_LENGTH)

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
)

export const IngestEventRequestSchema = z.strictObject({
  type: EventTypeSchema,
  data: JsonValueSchema,
})

export const IngestEventAcceptedSchema = z.strictObject({
  eventId: EventIdSchema,
  status: z.literal('accepted'),
  duplicate: z.boolean(),
  deliveryCount: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
})

export type IngestEventRequest = z.infer<typeof IngestEventRequestSchema>

export type IngestEventAccepted = z.infer<typeof IngestEventAcceptedSchema>
