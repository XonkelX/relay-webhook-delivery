import type { JsonValue } from '@relay/contracts'
import { sha256Hex } from './auth.js'
import { canonicalizeJson } from './canonical-json.js'
import type { RelayDatabase, RelayStatement } from './database.js'
import type { RelayIdPrefix } from './ids.js'
import { createPrefixedId } from './ids.js'
import type { ParsedIngestRequest } from './ingest-request.js'

interface ExistingEventRow {
  id: string
  event_type: string
  payload_sha256: string
  created_at: string
}

interface EndpointRow {
  id: string
}

interface DeliveryCountRow {
  delivery_count: number
}

export interface IngestEventAccepted {
  eventId: string
  duplicate: boolean
  deliveryCount: number
  createdAt: string
}

export type IngestEventResult =
  | {
      ok: true
      value: IngestEventAccepted
    }
  | {
      ok: false
      reason: 'idempotency_conflict'
    }
  | {
      ok: false
      reason: 'quota_exceeded'
      scope: 'api_key' | 'global'
    }

export interface IngestEventDependencies {
  now?: () => string
  createId?: (prefix: RelayIdPrefix) => string
}

async function findExistingEvent(
  database: RelayDatabase,
  apiKeyId: string,
  idempotencyKey: string,
): Promise<ExistingEventRow | null> {
  return database
    .prepare(
      `SELECT id, event_type, payload_sha256, created_at
       FROM events
       WHERE api_key_id = ?
         AND idempotency_key = ?
       LIMIT 1`,
    )
    .bind(apiKeyId, idempotencyKey)
    .first<ExistingEventRow>()
}

async function countDeliveries(database: RelayDatabase, eventId: string): Promise<number> {
  const row = await database
    .prepare(
      `SELECT COUNT(*) AS delivery_count
       FROM deliveries
       WHERE event_id = ?`,
    )
    .bind(eventId)
    .first<DeliveryCountRow>()

  return row?.delivery_count ?? 0
}

async function reconcileExistingEvent(
  database: RelayDatabase,
  existing: ExistingEventRow,
  eventType: string,
  payloadHash: string,
): Promise<IngestEventResult> {
  if (existing.event_type !== eventType || existing.payload_sha256 !== payloadHash) {
    return {
      ok: false,
      reason: 'idempotency_conflict',
    }
  }

  return {
    ok: true,
    value: {
      eventId: existing.id,
      duplicate: true,
      deliveryCount: await countDeliveries(database, existing.id),
      createdAt: existing.created_at,
    },
  }
}

export async function ingestEvent(
  database: RelayDatabase,
  apiKeyId: string,
  request: ParsedIngestRequest,
  dependencies: IngestEventDependencies = {},
): Promise<IngestEventResult> {
  const now = dependencies.now ?? (() => new Date().toISOString())
  const createId = dependencies.createId ?? createPrefixedId

  const hashInput: JsonValue = {
    type: request.event.type,
    data: request.event.data,
  }

  const payloadHash = await sha256Hex(canonicalizeJson(hashInput))

  const existing = await findExistingEvent(database, apiKeyId, request.idempotencyKey)

  if (existing) {
    return reconcileExistingEvent(database, existing, request.event.type, payloadHash)
  }

  const endpointResult = await database
    .prepare(
      `SELECT endpoints.id
       FROM endpoints
       INNER JOIN endpoint_subscriptions
         ON endpoint_subscriptions.endpoint_id = endpoints.id
       WHERE endpoints.status = 'active'
         AND endpoint_subscriptions.event_type = ?
       ORDER BY endpoints.id`,
    )
    .bind(request.event.type)
    .all<EndpointRow>()

  const createdAt = now()
  const usageDate = createdAt.slice(0, 10)
  const eventId = createId('evt')
  const payloadJson = canonicalizeJson(request.event.data)
  const statements: RelayStatement[] = []

  statements.push(
    database
      .prepare(
        `INSERT INTO events (
           id,
           api_key_id,
           idempotency_key,
           event_type,
           payload_json,
           payload_sha256,
           payload_bytes,
           created_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        eventId,
        apiKeyId,
        request.idempotencyKey,
        request.event.type,
        payloadJson,
        payloadHash,
        request.payloadBytes,
        createdAt,
      ),
  )

  for (const endpoint of endpointResult.results) {
    const deliveryId = createId('dlv')
    const outboxId = createId('out')

    statements.push(
      database
        .prepare(
          `INSERT INTO deliveries (
             id,
             event_id,
             endpoint_id,
             status,
             attempt_count,
             next_attempt_at,
             created_at,
             updated_at
           )
           VALUES (?, ?, ?, 'queued', 0, ?, ?, ?)`,
        )
        .bind(deliveryId, eventId, endpoint.id, createdAt, createdAt, createdAt),
    )

    statements.push(
      database
        .prepare(
          `INSERT INTO delivery_outbox (
             id,
             delivery_id,
             available_at,
             publish_attempts,
             created_at
           )
           VALUES (?, ?, ?, 0, ?)`,
        )
        .bind(outboxId, deliveryId, createdAt, createdAt),
    )
  }

  statements.push(
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
         VALUES (?, ?, 1, ?, ?, ?)
         ON CONFLICT (api_key_id, usage_date)
         DO UPDATE SET
           accepted_event_count = accepted_event_count + 1,
           generated_delivery_count =
             generated_delivery_count + excluded.generated_delivery_count,
           payload_bytes = payload_bytes + excluded.payload_bytes,
           updated_at = excluded.updated_at`,
      )
      .bind(apiKeyId, usageDate, endpointResult.results.length, request.payloadBytes, createdAt),
  )

  statements.push(
    database
      .prepare(
        `INSERT INTO global_daily_usage (
           usage_date,
           accepted_event_count,
           generated_delivery_count,
           payload_bytes,
           updated_at
         )
         VALUES (?, 1, ?, ?, ?)
         ON CONFLICT (usage_date)
         DO UPDATE SET
           accepted_event_count =
             accepted_event_count + 1,
           generated_delivery_count =
             generated_delivery_count +
             excluded.generated_delivery_count,
           payload_bytes =
             payload_bytes + excluded.payload_bytes,
           updated_at = excluded.updated_at`,
      )
      .bind(usageDate, endpointResult.results.length, request.payloadBytes, createdAt),
  )

  statements.push(
    database
      .prepare(
        `INSERT INTO audit_log (
           id,
           actor_type,
           actor_id,
           action,
           target_type,
           target_id,
           metadata_json,
           created_at
         )
         VALUES (?, 'api_key', ?, 'event.accepted', 'event', ?, ?, ?)`,
      )
      .bind(
        createId('aud'),
        apiKeyId,
        eventId,
        canonicalizeJson({
          eventType: request.event.type,
          deliveryCount: endpointResult.results.length,
        }),
        createdAt,
      ),
  )

  try {
    await database.batch(statements)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    if (errorMessage.includes('quota_per_key_daily')) {
      return {
        ok: false,
        reason: 'quota_exceeded',
        scope: 'api_key',
      }
    }

    if (errorMessage.includes('quota_global_daily')) {
      return {
        ok: false,
        reason: 'quota_exceeded',
        scope: 'global',
      }
    }

    const concurrentEvent = await findExistingEvent(database, apiKeyId, request.idempotencyKey)

    if (concurrentEvent) {
      return reconcileExistingEvent(database, concurrentEvent, request.event.type, payloadHash)
    }

    throw error
  }

  return {
    ok: true,
    value: {
      eventId,
      duplicate: false,
      deliveryCount: endpointResult.results.length,
      createdAt,
    },
  }
}
