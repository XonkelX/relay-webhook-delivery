import type { JsonValue } from '@relay/contracts'
import type { RelayDatabase } from './database.js'

interface DeliveryContextRow {
  delivery_id: string
  event_id: string
  endpoint_id: string
  endpoint_url: string
  event_type: string
  payload_json: string
  event_created_at: string
}

export interface DeliveryContext {
  deliveryId: string
  eventId: string
  endpointId: string
  endpointUrl: string
  eventType: string
  eventData: JsonValue
  eventCreatedAt: string
}

export async function loadDeliveryContext(
  database: RelayDatabase,
  deliveryId: string,
): Promise<DeliveryContext | null> {
  const row = await database
    .prepare(
      `SELECT
         deliveries.id AS delivery_id,
         events.id AS event_id,
         endpoints.id AS endpoint_id,
         endpoints.url AS endpoint_url,
         events.event_type,
         events.payload_json,
         events.created_at AS event_created_at
       FROM deliveries
       INNER JOIN events
         ON events.id = deliveries.event_id
       INNER JOIN endpoints
         ON endpoints.id = deliveries.endpoint_id
       WHERE deliveries.id = ?
       LIMIT 1`,
    )
    .bind(deliveryId)
    .first<DeliveryContextRow>()

  if (!row) {
    return null
  }

  return {
    deliveryId: row.delivery_id,
    eventId: row.event_id,
    endpointId: row.endpoint_id,
    endpointUrl: row.endpoint_url,
    eventType: row.event_type,
    eventData: JSON.parse(row.payload_json) as JsonValue,
    eventCreatedAt: row.event_created_at,
  }
}
