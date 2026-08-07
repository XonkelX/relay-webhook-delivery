import type { DeliveryStatus, ReplayDeliveryAccepted } from '@relay/contracts'
import { canonicalizeJson } from './canonical-json.js'
import type { RelayDatabase, RelayStatement } from './database.js'
import type { RelayIdPrefix } from './ids.js'
import { createPrefixedId } from './ids.js'

interface ReplaySourceRow {
  delivery_id: string
  event_id: string
  endpoint_id: string
  delivery_status: DeliveryStatus
  endpoint_status: 'pending' | 'active' | 'paused' | 'disabled'
  api_key_id: string
}

export type ReplayDeliveryResult =
  | {
      ok: true
      value: ReplayDeliveryAccepted
    }
  | {
      ok: false
      reason: 'missing' | 'source_not_terminal' | 'endpoint_inactive'
    }

export interface ReplayDeliveryDependencies {
  now?: () => string
  createId?: (prefix: RelayIdPrefix) => string
}

export async function replayDelivery(
  database: RelayDatabase,
  sourceDeliveryId: string,
  dependencies: ReplayDeliveryDependencies = {},
): Promise<ReplayDeliveryResult> {
  const source = await database
    .prepare(
      `SELECT
         deliveries.id AS delivery_id,
         deliveries.event_id,
         deliveries.endpoint_id,
         deliveries.status AS delivery_status,
         endpoints.status AS endpoint_status,
         events.api_key_id
       FROM deliveries
       INNER JOIN endpoints
         ON endpoints.id = deliveries.endpoint_id
       INNER JOIN events
         ON events.id = deliveries.event_id
       WHERE deliveries.id = ?
       LIMIT 1`,
    )
    .bind(sourceDeliveryId)
    .first<ReplaySourceRow>()

  if (!source) {
    return {
      ok: false,
      reason: 'missing',
    }
  }

  if (
    source.delivery_status !== 'delivered' &&
    source.delivery_status !== 'exhausted' &&
    source.delivery_status !== 'cancelled'
  ) {
    return {
      ok: false,
      reason: 'source_not_terminal',
    }
  }

  if (source.endpoint_status !== 'active') {
    return {
      ok: false,
      reason: 'endpoint_inactive',
    }
  }

  const now = dependencies.now ?? (() => new Date().toISOString())
  const createId = dependencies.createId ?? createPrefixedId

  const createdAt = now()
  const usageDate = createdAt.slice(0, 10)

  const deliveryId = createId('dlv')
  const outboxId = createId('out')
  const auditId = createId('aud')

  const statements: RelayStatement[] = [
    database
      .prepare(
        `INSERT INTO deliveries (
           id,
           event_id,
           endpoint_id,
           status,
           attempt_count,
           next_attempt_at,
           replay_of_delivery_id,
           created_at,
           updated_at
         )
         VALUES (
           ?,
           ?,
           ?,
           'queued',
           0,
           ?,
           ?,
           ?,
           ?
         )`,
      )
      .bind(
        deliveryId,
        source.event_id,
        source.endpoint_id,
        createdAt,
        source.delivery_id,
        createdAt,
        createdAt,
      ),

    database
      .prepare(
        `INSERT INTO delivery_outbox (
           id,
           delivery_id,
           available_at,
           published_at,
           publish_attempts,
           last_error,
           created_at,
           reason
         )
         VALUES (
           ?,
           ?,
           ?,
           NULL,
           0,
           NULL,
           ?,
           'replay'
         )`,
      )
      .bind(outboxId, deliveryId, createdAt, createdAt),

    database
      .prepare(
        `INSERT INTO daily_usage (
           api_key_id,
           usage_date,
           accepted_event_count,
           generated_delivery_count,
           payload_bytes,
           updated_at
         )
         VALUES (?, ?, 0, 1, 0, ?)
         ON CONFLICT (api_key_id, usage_date)
         DO UPDATE SET
           generated_delivery_count =
             daily_usage.generated_delivery_count + 1,
           updated_at = excluded.updated_at`,
      )
      .bind(source.api_key_id, usageDate, createdAt),

    database
      .prepare(
        `INSERT INTO global_daily_usage (
           usage_date,
           accepted_event_count,
           generated_delivery_count,
           payload_bytes,
           updated_at
         )
         VALUES (?, 0, 1, 0, ?)
         ON CONFLICT (usage_date)
         DO UPDATE SET
           generated_delivery_count =
             global_daily_usage.generated_delivery_count + 1,
           updated_at = excluded.updated_at`,
      )
      .bind(usageDate, createdAt),

    database
      .prepare(
        `INSERT INTO audit_log (
           id,
           actor_type,
           action,
           target_type,
           target_id,
           metadata_json,
           created_at
         )
         VALUES (
           ?,
           'owner',
           'delivery.replayed',
           'delivery',
           ?,
           ?,
           ?
         )`,
      )
      .bind(
        auditId,
        deliveryId,
        canonicalizeJson({
          replayOfDeliveryId: source.delivery_id,
          eventId: source.event_id,
          endpointId: source.endpoint_id,
        }),
        createdAt,
      ),
  ]

  await database.batch(statements)

  return {
    ok: true,
    value: {
      deliveryId,
      replayOfDeliveryId: source.delivery_id,
      status: 'queued',
      createdAt,
    },
  }
}
