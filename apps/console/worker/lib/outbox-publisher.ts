import type { DeliveryQueueMessage } from '@relay/contracts'
import type { RelayDatabase } from './database.js'

interface PendingOutboxRow {
  id: string
  delivery_id: string
}

export interface DeliveryQueueProducer {
  send(
    message: DeliveryQueueMessage,
    options: {
      contentType: 'json'
    },
  ): Promise<void>
}

export interface PublishOutboxResult {
  published: number
  failed: number
}

export async function publishEventOutbox(
  database: RelayDatabase,
  queue: DeliveryQueueProducer,
  eventId: string,
  publishedAt = new Date().toISOString(),
): Promise<PublishOutboxResult> {
  const pending = await database
    .prepare(
      `SELECT delivery_outbox.id, delivery_outbox.delivery_id
       FROM delivery_outbox
       INNER JOIN deliveries
         ON deliveries.id = delivery_outbox.delivery_id
       WHERE deliveries.event_id = ?
         AND delivery_outbox.published_at IS NULL
       ORDER BY delivery_outbox.created_at, delivery_outbox.id`,
    )
    .bind(eventId)
    .all<PendingOutboxRow>()

  let published = 0
  let failed = 0

  for (const row of pending.results) {
    try {
      await queue.send(
        {
          version: 1,
          deliveryId: row.delivery_id,
          reason: 'initial',
        },
        {
          contentType: 'json',
        },
      )

      await database
        .prepare(
          `UPDATE delivery_outbox
           SET published_at = ?,
               publish_attempts = publish_attempts + 1,
               last_error = NULL
           WHERE id = ?
             AND published_at IS NULL`,
        )
        .bind(publishedAt, row.id)
        .run()

      published += 1
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown queue error'

      await database
        .prepare(
          `UPDATE delivery_outbox
           SET publish_attempts = publish_attempts + 1,
               last_error = ?
           WHERE id = ?
             AND published_at IS NULL`,
        )
        .bind(message.slice(0, 500), row.id)
        .run()

      failed += 1
    }
  }

  return {
    published,
    failed,
  }
}
