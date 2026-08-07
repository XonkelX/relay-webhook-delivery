import type { EndpointHealth, EndpointListResponse, EndpointStatus } from '@relay/contracts'
import type { RelayDatabase } from './database.js'

interface EndpointRow {
  id: string
  name: string
  url: string
  status: EndpointStatus
  verified_at: string | null
  updated_at: string
  delivered_24h: number
  exhausted_24h: number
  event_count_24h: number
  average_latency_ms_24h: number | null
  last_delivery_at: string | null
  secret_generation: number | null
  previous_secret_valid_until: string | null
}

interface SubscriptionRow {
  endpoint_id: string
  event_type: string
}

function deriveHealth(
  status: EndpointStatus,
  delivered: number,
  exhausted: number,
): EndpointHealth {
  if (status !== 'active') {
    return 'unknown'
  }

  if (delivered + exhausted === 0) {
    return 'unknown'
  }

  return exhausted > 0 ? 'degraded' : 'healthy'
}

export async function listOwnerEndpoints(
  database: RelayDatabase,
  now: Date = new Date(),
): Promise<EndpointListResponse> {
  const nowIso = now.toISOString()
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()

  const endpointResult = await database
    .prepare(
      `SELECT
         endpoints.id,
         endpoints.name,
         endpoints.url,
         endpoints.status,
         endpoints.verified_at,
         endpoints.updated_at,

         (
           SELECT COUNT(*)
           FROM deliveries
           WHERE deliveries.endpoint_id = endpoints.id
             AND deliveries.delivered_at >= ?
         ) AS delivered_24h,

         (
           SELECT COUNT(*)
           FROM deliveries
           WHERE deliveries.endpoint_id = endpoints.id
             AND deliveries.exhausted_at >= ?
         ) AS exhausted_24h,

         (
           SELECT COUNT(DISTINCT deliveries.event_id)
           FROM deliveries
           WHERE deliveries.endpoint_id = endpoints.id
             AND deliveries.created_at >= ?
         ) AS event_count_24h,

         (
           SELECT AVG(delivery_attempts.latency_ms)
           FROM delivery_attempts
           INNER JOIN deliveries
             ON deliveries.id =
                delivery_attempts.delivery_id
           WHERE deliveries.endpoint_id = endpoints.id
             AND delivery_attempts.state = 'completed'
             AND delivery_attempts.completed_at >= ?
             AND delivery_attempts.latency_ms IS NOT NULL
         ) AS average_latency_ms_24h,

         (
           SELECT MAX(deliveries.created_at)
           FROM deliveries
           WHERE deliveries.endpoint_id = endpoints.id
         ) AS last_delivery_at,

         (
           SELECT endpoint_signing_secrets.generation
           FROM endpoint_signing_secrets
           WHERE endpoint_signing_secrets.endpoint_id =
                 endpoints.id
             AND endpoint_signing_secrets.state = 'active'
           LIMIT 1
         ) AS secret_generation,

         (
           SELECT MAX(endpoint_signing_secrets.valid_until)
           FROM endpoint_signing_secrets
           WHERE endpoint_signing_secrets.endpoint_id =
                 endpoints.id
             AND endpoint_signing_secrets.state = 'previous'
             AND endpoint_signing_secrets.valid_until > ?
         ) AS previous_secret_valid_until

       FROM endpoints
       ORDER BY
         endpoints.created_at DESC,
         endpoints.id DESC`,
    )
    .bind(since24h, since24h, since24h, since24h, nowIso)
    .all<EndpointRow>()

  const subscriptionResult = await database
    .prepare(
      `SELECT
         endpoint_id,
         event_type
       FROM endpoint_subscriptions
       ORDER BY
         endpoint_id ASC,
         event_type ASC`,
    )
    .all<SubscriptionRow>()

  const subscriptions = new Map<string, string[]>()

  for (const row of subscriptionResult.results) {
    const values = subscriptions.get(row.endpoint_id) ?? []

    values.push(row.event_type)
    subscriptions.set(row.endpoint_id, values)
  }

  return {
    items: endpointResult.results.map((row) => {
      const terminal = row.delivered_24h + row.exhausted_24h

      return {
        id: row.id,
        name: row.name,
        url: row.url,
        status: row.status,
        health: deriveHealth(row.status, row.delivered_24h, row.exhausted_24h),
        verifiedAt: row.verified_at,
        updatedAt: row.updated_at,
        subscriptions: subscriptions.get(row.id) ?? [],
        successRate24h: terminal === 0 ? null : (row.delivered_24h / terminal) * 100,
        averageLatencyMs24h: row.average_latency_ms_24h,
        eventCount24h: row.event_count_24h,
        lastDeliveryAt: row.last_delivery_at,
        secretGeneration: row.secret_generation,
        previousSecretValidUntil: row.previous_secret_valid_until,
      }
    }),
  }
}
