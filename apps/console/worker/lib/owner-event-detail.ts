import {
  JsonValueSchema,
  type AttemptOutcome,
  type DeliveryStatus,
  type EndpointStatus,
  type EventDetailResponse,
  type EventOperationalStatus,
} from '@relay/contracts'
import type { RelayDatabase } from './database.js'
import {
  buildSafeRequestHeaders,
  explainDeliveryRetry,
  parseSafeResponseHeaders,
  sanitizePayloadForInspector,
} from './inspector-evidence.js'

interface EventRow {
  id: string
  event_type: string
  created_at: string
  payload_json: string
  payload_bytes: number
  queued_count: number
  leased_count: number
  retrying_count: number
  delivered_count: number
  exhausted_count: number
  cancelled_count: number
  delivery_count: number
}

interface DeliveryRow {
  id: string
  endpoint_id: string
  endpoint_name: string
  endpoint_url: string
  endpoint_status: EndpointStatus
  status: DeliveryStatus
  attempt_count: number
  next_attempt_at: string
  replay_of_delivery_id: string | null
  last_error_class: string | null
  created_at: string
  updated_at: string
  delivered_at: string | null
  exhausted_at: string | null
}

interface AttemptRow {
  id: string
  delivery_id: string
  attempt_no: number
  state: 'started' | 'completed'
  outcome: AttemptOutcome | null
  webhook_id: string | null
  request_started_at: string
  completed_at: string | null
  status_code: number | null
  latency_ms: number | null
  error_class: string | null
  response_headers_json: string | null
  response_excerpt: string | null
}

function deriveOperationalStatus(row: EventRow): EventOperationalStatus {
  if (row.delivery_count === 0) {
    return 'no_deliveries'
  }

  const activeStatuses: DeliveryStatus[] = []

  if (row.queued_count > 0) activeStatuses.push('queued')
  if (row.leased_count > 0) activeStatuses.push('leased')
  if (row.retrying_count > 0) activeStatuses.push('retrying')
  if (row.delivered_count > 0) activeStatuses.push('delivered')
  if (row.exhausted_count > 0) activeStatuses.push('exhausted')
  if (row.cancelled_count > 0) activeStatuses.push('cancelled')

  return activeStatuses.length === 1 ? activeStatuses[0]! : 'mixed'
}

export async function loadOwnerEventDetail(
  database: RelayDatabase,
  eventId: string,
): Promise<EventDetailResponse | null> {
  const event = await database
    .prepare(
      `SELECT
         events.id,
         events.event_type,
         events.created_at,
         events.payload_json,
         events.payload_bytes,
         SUM(
           CASE WHEN deliveries.status = 'queued'
             THEN 1 ELSE 0 END
         ) AS queued_count,
         SUM(
           CASE WHEN deliveries.status = 'leased'
             THEN 1 ELSE 0 END
         ) AS leased_count,
         SUM(
           CASE WHEN deliveries.status = 'retrying'
             THEN 1 ELSE 0 END
         ) AS retrying_count,
         SUM(
           CASE WHEN deliveries.status = 'delivered'
             THEN 1 ELSE 0 END
         ) AS delivered_count,
         SUM(
           CASE WHEN deliveries.status = 'exhausted'
             THEN 1 ELSE 0 END
         ) AS exhausted_count,
         SUM(
           CASE WHEN deliveries.status = 'cancelled'
             THEN 1 ELSE 0 END
         ) AS cancelled_count,
         COUNT(deliveries.id) AS delivery_count
       FROM events
       LEFT JOIN deliveries
         ON deliveries.event_id = events.id
       WHERE events.id = ?
       GROUP BY
         events.id,
         events.event_type,
         events.created_at,
         events.payload_json,
         events.payload_bytes
       LIMIT 1`,
    )
    .bind(eventId)
    .first<EventRow>()

  if (!event) {
    return null
  }

  const deliveryResult = await database
    .prepare(
      `SELECT
         deliveries.id,
         endpoints.id AS endpoint_id,
         endpoints.name AS endpoint_name,
         endpoints.url AS endpoint_url,
         endpoints.status AS endpoint_status,
         deliveries.status,
         deliveries.attempt_count,
         deliveries.next_attempt_at,
         deliveries.replay_of_delivery_id,
         deliveries.last_error_class,
         deliveries.created_at,
         deliveries.updated_at,
         deliveries.delivered_at,
         deliveries.exhausted_at
       FROM deliveries
       INNER JOIN endpoints
         ON endpoints.id = deliveries.endpoint_id
       WHERE deliveries.event_id = ?
       ORDER BY
         deliveries.created_at ASC,
         deliveries.id ASC`,
    )
    .bind(eventId)
    .all<DeliveryRow>()

  const attemptResult = await database
    .prepare(
      `SELECT
         delivery_attempts.id,
         delivery_attempts.delivery_id,
         delivery_attempts.attempt_no,
         delivery_attempts.state,
         delivery_attempts.outcome,
         delivery_attempts.webhook_id,
         delivery_attempts.request_started_at,
         delivery_attempts.completed_at,
         delivery_attempts.status_code,
         delivery_attempts.latency_ms,
         delivery_attempts.error_class,
         delivery_attempts.response_headers_json,
         delivery_attempts.response_excerpt
       FROM delivery_attempts
       INNER JOIN deliveries
         ON deliveries.id = delivery_attempts.delivery_id
       WHERE deliveries.event_id = ?
       ORDER BY
         delivery_attempts.delivery_id ASC,
         delivery_attempts.attempt_no ASC`,
    )
    .bind(eventId)
    .all<AttemptRow>()

  const attemptsByDelivery = new Map<
    string,
    EventDetailResponse['deliveries'][number]['attempts']
  >()

  for (const attempt of attemptResult.results) {
    const attempts = attemptsByDelivery.get(attempt.delivery_id) ?? []

    attempts.push({
      id: attempt.id,
      webhookId: attempt.webhook_id,
      number: attempt.attempt_no,
      state: attempt.state,
      outcome: attempt.outcome,
      requestStartedAt: attempt.request_started_at,
      completedAt: attempt.completed_at,
      statusCode: attempt.status_code,
      latencyMs: attempt.latency_ms,
      errorClass: attempt.error_class,
      requestHeaders: buildSafeRequestHeaders(attempt.webhook_id, attempt.request_started_at),
      responseHeaders: parseSafeResponseHeaders(attempt.response_headers_json),
      responseExcerpt: attempt.response_excerpt,
    })

    attemptsByDelivery.set(attempt.delivery_id, attempts)
  }

  const replaysBySource = new Map<string, string[]>()

  for (const delivery of deliveryResult.results) {
    if (!delivery.replay_of_delivery_id) continue

    const replays = replaysBySource.get(delivery.replay_of_delivery_id) ?? []

    replays.push(delivery.id)
    replaysBySource.set(delivery.replay_of_delivery_id, replays)
  }

  const payload = JsonValueSchema.parse(JSON.parse(event.payload_json))

  return {
    event: {
      id: event.id,
      eventType: event.event_type,
      createdAt: event.created_at,
      payloadBytes: event.payload_bytes,
      status: deriveOperationalStatus(event),
      deliveries: {
        queued: event.queued_count,
        leased: event.leased_count,
        retrying: event.retrying_count,
        delivered: event.delivered_count,
        exhausted: event.exhausted_count,
        cancelled: event.cancelled_count,
        total: event.delivery_count,
      },
    },

    safePayload: sanitizePayloadForInspector(payload),

    deliveries: deliveryResult.results.map((delivery) => {
      const attempts = attemptsByDelivery.get(delivery.id) ?? []

      const latestAttempt = attempts[attempts.length - 1] ?? null

      return {
        id: delivery.id,
        endpoint: {
          id: delivery.endpoint_id,
          name: delivery.endpoint_name,
          url: delivery.endpoint_url,
          status: delivery.endpoint_status,
        },
        status: delivery.status,
        attemptCount: delivery.attempt_count,
        nextAttemptAt: delivery.next_attempt_at,
        replayOfDeliveryId: delivery.replay_of_delivery_id,
        replayedByDeliveryIds: replaysBySource.get(delivery.id) ?? [],
        retryExplanation: explainDeliveryRetry({
          status: delivery.status,
          attemptCount: delivery.attempt_count,
          nextAttemptAt: delivery.next_attempt_at,
          replayOfDeliveryId: delivery.replay_of_delivery_id,
          lastErrorClass: delivery.last_error_class,
          latestAttempt: latestAttempt
            ? {
                outcome: latestAttempt.outcome,
                statusCode: latestAttempt.statusCode,
                completedAt: latestAttempt.completedAt,
                errorClass: latestAttempt.errorClass,
              }
            : null,
        }),
        lastErrorClass: delivery.last_error_class,
        createdAt: delivery.created_at,
        updatedAt: delivery.updated_at,
        deliveredAt: delivery.delivered_at,
        exhaustedAt: delivery.exhausted_at,
        attempts,
      }
    }),
  }
}
