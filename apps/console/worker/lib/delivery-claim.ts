import type { DeliveryStatus } from '@relay/contracts'
import type { RelayDatabase } from './database.js'

const DEFAULT_LEASE_SECONDS = 30
const MAX_LEASE_SECONDS = 15 * 60

interface ClaimedDeliveryRow {
  id: string
  event_id: string
  endpoint_id: string
  attempt_count: number
  lease_token: string
  lease_expires_at: string
}

interface DeliveryStateRow {
  status: DeliveryStatus
  next_attempt_at: string
  lease_expires_at: string | null
}

export interface ClaimedDelivery {
  id: string
  eventId: string
  endpointId: string
  attemptNo: number
  leaseToken: string
  leaseExpiresAt: string
}

export type ClaimDeliveryResult =
  | {
      ok: true
      value: ClaimedDelivery
    }
  | {
      ok: false
      reason: 'missing' | 'terminal' | 'leased' | 'scheduled' | 'contended'
    }

export interface ClaimDeliveryDependencies {
  now?: () => string
  createLeaseToken?: () => string
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function createLeaseToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)

  return `lease_${bytesToHex(bytes)}`
}

function calculateLeaseExpiry(claimedAt: string, leaseSeconds: number): string {
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > MAX_LEASE_SECONDS) {
    throw new TypeError('Delivery lease must be an integer between 1 and 900 seconds.')
  }

  const claimedTime = Date.parse(claimedAt)

  if (!Number.isFinite(claimedTime)) {
    throw new TypeError('Delivery claim time must be a valid ISO timestamp.')
  }

  return new Date(claimedTime + leaseSeconds * 1000).toISOString()
}

export async function claimDelivery(
  database: RelayDatabase,
  deliveryId: string,
  leaseSeconds = DEFAULT_LEASE_SECONDS,
  dependencies: ClaimDeliveryDependencies = {},
): Promise<ClaimDeliveryResult> {
  const now = dependencies.now ?? (() => new Date().toISOString())
  const makeLeaseToken = dependencies.createLeaseToken ?? createLeaseToken

  const claimedAt = now()
  const leaseExpiresAt = calculateLeaseExpiry(claimedAt, leaseSeconds)
  const leaseToken = makeLeaseToken()

  const claimed = await database
    .prepare(
      `UPDATE deliveries
       SET status = 'leased',
           lease_token = ?,
           lease_expires_at = ?,
           updated_at = ?
       WHERE id = ?
         AND next_attempt_at <= ?
         AND (
           status IN ('queued', 'retrying')
           OR (
             status = 'leased'
             AND lease_expires_at <= ?
           )
         )
       RETURNING
         id,
         event_id,
         endpoint_id,
         attempt_count,
         lease_token,
         lease_expires_at`,
    )
    .bind(leaseToken, leaseExpiresAt, claimedAt, deliveryId, claimedAt, claimedAt)
    .first<ClaimedDeliveryRow>()

  if (claimed) {
    return {
      ok: true,
      value: {
        id: claimed.id,
        eventId: claimed.event_id,
        endpointId: claimed.endpoint_id,
        attemptNo: claimed.attempt_count + 1,
        leaseToken: claimed.lease_token,
        leaseExpiresAt: claimed.lease_expires_at,
      },
    }
  }

  const state = await database
    .prepare(
      `SELECT status, next_attempt_at, lease_expires_at
       FROM deliveries
       WHERE id = ?
       LIMIT 1`,
    )
    .bind(deliveryId)
    .first<DeliveryStateRow>()

  if (!state) {
    return {
      ok: false,
      reason: 'missing',
    }
  }

  if (
    state.status === 'delivered' ||
    state.status === 'exhausted' ||
    state.status === 'cancelled'
  ) {
    return {
      ok: false,
      reason: 'terminal',
    }
  }

  if (
    state.status === 'leased' &&
    state.lease_expires_at !== null &&
    state.lease_expires_at > claimedAt
  ) {
    return {
      ok: false,
      reason: 'leased',
    }
  }

  if (
    (state.status === 'queued' || state.status === 'retrying') &&
    state.next_attempt_at > claimedAt
  ) {
    return {
      ok: false,
      reason: 'scheduled',
    }
  }

  return {
    ok: false,
    reason: 'contended',
  }
}
