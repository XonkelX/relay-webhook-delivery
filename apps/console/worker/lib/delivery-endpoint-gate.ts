import type { RelayDatabase } from './database.js'

interface CancelledDeliveryRow {
  id: string
}

export async function cancelClaimedDeliveryIfEndpointInactive(
  database: RelayDatabase,
  deliveryId: string,
  leaseToken: string,
  cancelledAt: string,
): Promise<boolean> {
  const cancelled = await database
    .prepare(
      `UPDATE deliveries
       SET status = 'cancelled',
           next_attempt_at = ?,
           lease_token = NULL,
           lease_expires_at = NULL,
           last_error_class = 'endpoint_inactive',
           updated_at = ?
       WHERE id = ?
         AND status = 'leased'
         AND lease_token = ?
         AND EXISTS (
           SELECT 1
           FROM endpoints
           WHERE endpoints.id = deliveries.endpoint_id
             AND endpoints.status != 'active'
         )
       RETURNING id`,
    )
    .bind(cancelledAt, cancelledAt, deliveryId, leaseToken)
    .first<CancelledDeliveryRow>()

  return cancelled !== null
}
