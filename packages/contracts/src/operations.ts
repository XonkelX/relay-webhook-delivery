import { z } from 'zod'
import { AttemptOutcomeSchema, DeliveryStatusSchema } from './delivery.js'
import { AttemptIdSchema, DeliveryIdSchema, EndpointIdSchema, EventIdSchema } from './ids.js'
import { EventTypeSchema } from './ingestion.js'

const TimestampSchema = z.string().min(1).max(64)
const NullableTimestampSchema = TimestampSchema.nullable()

export const EndpointStatusSchema = z.enum(['pending', 'active', 'paused', 'disabled'])

export const EndpointHealthSchema = z.enum(['healthy', 'degraded', 'unknown'])

export const EventOperationalStatusSchema = z.union([
  DeliveryStatusSchema,
  z.literal('mixed'),
  z.literal('no_deliveries'),
])

export const OperationsCursorSchema = z.string().min(1).max(512)

export const EventDeliveryCountsSchema = z
  .strictObject({
    queued: z.number().int().nonnegative(),
    leased: z.number().int().nonnegative(),
    retrying: z.number().int().nonnegative(),
    delivered: z.number().int().nonnegative(),
    exhausted: z.number().int().nonnegative(),
    cancelled: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  })
  .refine(
    (value) =>
      value.total ===
      value.queued +
        value.leased +
        value.retrying +
        value.delivered +
        value.exhausted +
        value.cancelled,
    {
      message: 'Delivery total must equal the sum of delivery states.',
      path: ['total'],
    },
  )

export const EventSummarySchema = z.strictObject({
  id: EventIdSchema,
  eventType: EventTypeSchema,
  createdAt: TimestampSchema,
  payloadBytes: z.number().int().nonnegative(),
  status: EventOperationalStatusSchema,
  deliveries: EventDeliveryCountsSchema,
})

export const EventStreamMetricsSchema = z.strictObject({
  events24h: z.number().int().nonnegative(),
  deliveredDeliveries24h: z.number().int().nonnegative(),
  retryingDeliveriesNow: z.number().int().nonnegative(),
  exhaustedDeliveries24h: z.number().int().nonnegative(),
  successRate24h: z.number().min(0).max(100).nullable(),
})

export const EventListResponseSchema = z.strictObject({
  items: z.array(EventSummarySchema),
  nextCursor: OperationsCursorSchema.nullable(),
  metrics: EventStreamMetricsSchema,
})

export const DeliveryAttemptDetailSchema = z.strictObject({
  id: AttemptIdSchema,
  webhookId: z
    .string()
    .max(80)
    .regex(/^msg_[A-Za-z0-9]+$/)
    .nullable(),
  number: z.number().int().positive(),
  state: z.enum(['started', 'completed']),
  outcome: AttemptOutcomeSchema.nullable(),
  requestStartedAt: TimestampSchema,
  completedAt: NullableTimestampSchema,
  statusCode: z.number().int().min(100).max(599).nullable(),
  latencyMs: z.number().int().nonnegative().nullable(),
  errorClass: z.string().max(160).nullable(),
  responseExcerpt: z.string().nullable(),
})

export const DeliveryEndpointSchema = z.strictObject({
  id: EndpointIdSchema,
  name: z.string().min(1).max(100),
  url: z.string().url(),
  status: EndpointStatusSchema,
})

export const DeliveryDetailSchema = z.strictObject({
  id: DeliveryIdSchema,
  endpoint: DeliveryEndpointSchema,
  status: DeliveryStatusSchema,
  attemptCount: z.number().int().nonnegative(),
  nextAttemptAt: TimestampSchema,
  replayOfDeliveryId: DeliveryIdSchema.nullable(),
  lastErrorClass: z.string().max(160).nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  deliveredAt: NullableTimestampSchema,
  exhaustedAt: NullableTimestampSchema,
  attempts: z.array(DeliveryAttemptDetailSchema),
})

export const EventDetailResponseSchema = z.strictObject({
  event: EventSummarySchema,
  deliveries: z.array(DeliveryDetailSchema),
})

export const EndpointSummarySchema = z.strictObject({
  id: EndpointIdSchema,
  name: z.string().min(1).max(100),
  url: z.string().url(),
  status: EndpointStatusSchema,
  health: EndpointHealthSchema,
  verifiedAt: NullableTimestampSchema,
  updatedAt: TimestampSchema,
  subscriptions: z.array(EventTypeSchema),
  successRate24h: z.number().min(0).max(100).nullable(),
  averageLatencyMs24h: z.number().nonnegative().nullable(),
  eventCount24h: z.number().int().nonnegative(),
  lastDeliveryAt: NullableTimestampSchema,
  secretGeneration: z.number().int().positive().nullable(),
  previousSecretValidUntil: NullableTimestampSchema,
})

export const EndpointListResponseSchema = z.strictObject({
  items: z.array(EndpointSummarySchema),
})

export const OverviewResponseSchema = z.strictObject({
  events24h: z.number().int().nonnegative(),
  deliveries24h: z.number().int().nonnegative(),
  delivered24h: z.number().int().nonnegative(),
  retryingNow: z.number().int().nonnegative(),
  exhausted24h: z.number().int().nonnegative(),
  successRate24h: z.number().min(0).max(100).nullable(),
  medianLatencyMs24h: z.number().nonnegative().nullable(),
  endpointCount: z.number().int().nonnegative(),
  activeEndpointCount: z.number().int().nonnegative(),
  oldestRetryAt: NullableTimestampSchema,
  recentEvents: z.array(EventSummarySchema).max(10),
  endpoints: z.array(EndpointSummarySchema).max(10),
})

export const OperationalGuardrailsSchema = z.strictObject({
  schedulerIntervalSeconds: z.number().int().positive(),
  claimsPerTick: z.number().int().positive(),
  maxDailyClaims: z.number().int().positive(),
  maxDeliveryAttempts: z.number().int().positive(),
  requestTimeoutMs: z.number().int().positive(),
  maxPayloadBytes: z.number().int().positive(),
  maxResponseCaptureBytes: z.number().int().positive(),
  eventRetentionDays: z.number().int().positive(),
  attemptRetentionDays: z.number().int().positive(),
})

export const SystemHealthResponseSchema = z.strictObject({
  queuedDeliveries: z.number().int().nonnegative(),
  oldestQueuedAt: NullableTimestampSchema,
  retryingDeliveries: z.number().int().nonnegative(),
  oldestRetryAt: NullableTimestampSchema,
  pendingOutbox: z.number().int().nonnegative(),
  oldestPendingOutboxAt: NullableTimestampSchema,
  successRate24h: z.number().min(0).max(100).nullable(),
  medianLatencyMs24h: z.number().nonnegative().nullable(),
  quotas: z.strictObject({
    perKeyDailyEventLimit: z.number().int().positive(),
    globalDailyEventLimit: z.number().int().positive(),
    globalAcceptedEventsToday: z.number().int().nonnegative(),
  }),
  guardrails: OperationalGuardrailsSchema,
})

export const ReplayDeliveryAcceptedSchema = z.strictObject({
  deliveryId: DeliveryIdSchema,
  replayOfDeliveryId: DeliveryIdSchema,
  status: z.literal('queued'),
  createdAt: TimestampSchema,
})

export type EndpointStatus = z.infer<typeof EndpointStatusSchema>
export type EndpointHealth = z.infer<typeof EndpointHealthSchema>
export type EventOperationalStatus = z.infer<typeof EventOperationalStatusSchema>
export type EventSummary = z.infer<typeof EventSummarySchema>
export type EventListResponse = z.infer<typeof EventListResponseSchema>
export type EventDetailResponse = z.infer<typeof EventDetailResponseSchema>
export type EndpointSummary = z.infer<typeof EndpointSummarySchema>
export type EndpointListResponse = z.infer<typeof EndpointListResponseSchema>
export type OverviewResponse = z.infer<typeof OverviewResponseSchema>
export type SystemHealthResponse = z.infer<typeof SystemHealthResponseSchema>
export type ReplayDeliveryAccepted = z.infer<typeof ReplayDeliveryAcceptedSchema>

export const OwnerSessionBootstrapRequestSchema = z.strictObject({
  token: z.string().min(1).max(512),
})

export const OwnerSessionBootstrapResponseSchema = z.strictObject({
  status: z.literal('authenticated'),
  expiresAt: TimestampSchema,
})

export type OwnerSessionBootstrapRequest = z.infer<typeof OwnerSessionBootstrapRequestSchema>
export type OwnerSessionBootstrapResponse = z.infer<typeof OwnerSessionBootstrapResponseSchema>
