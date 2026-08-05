import type { AttemptOutcome } from '@relay/contracts'
import { canonicalizeJson } from './canonical-json.js'
import type { RelayDatabase, RelayStatement } from './database.js'
import type { RelayIdPrefix } from './ids.js'
import { createPrefixedId } from './ids.js'

const DEFAULT_MAX_ATTEMPTS = 8

interface AttemptRow {
  id: string
  delivery_id: string
  attempt_no: number
  lease_token: string
  webhook_id: string
  request_started_at: string
}

interface CompletedAttemptRow {
  state: string
  outcome: AttemptOutcome | null
  completed_at: string | null
  lease_token: string | null
}

export interface StartedDeliveryAttempt {
  id: string
  deliveryId: string
  attemptNo: number
  leaseToken: string
  webhookId: string
  requestStartedAt: string
}

export interface StartDeliveryAttemptInput {
  deliveryId: string
  attemptNo: number
  leaseToken: string
  webhookId: string
  requestStartedAt: string
}

export interface CompleteDeliveryAttemptInput {
  deliveryId: string
  attemptNo: number
  leaseToken: string
  outcome: AttemptOutcome
  completedAt: string
  retryAt?: string | null
  statusCode?: number | null
  latencyMs?: number | null
  errorClass?: string | null
  responseHeaders?: Record<string, string> | null
  responseExcerpt?: string | null
  maxAttempts?: number
}

export interface StartAttemptDependencies {
  createId?: (prefix: RelayIdPrefix) => string
}

function validateAttemptNumber(attemptNo: number): void {
  if (!Number.isInteger(attemptNo) || attemptNo < 1) {
    throw new TypeError('Attempt number must be a positive integer.')
  }
}

function validateMaxAttempts(maxAttempts: number): void {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100) {
    throw new TypeError('Maximum attempts must be an integer between 1 and 100.')
  }
}

function validateEvidence(statusCode: number | null, latencyMs: number | null): void {
  if (
    statusCode !== null &&
    (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599)
  ) {
    throw new TypeError('Attempt status code must be null or an integer between 100 and 599.')
  }

  if (latencyMs !== null && (!Number.isInteger(latencyMs) || latencyMs < 0)) {
    throw new TypeError('Attempt latency must be null or a non-negative integer.')
  }
}

export async function startDeliveryAttempt(
  database: RelayDatabase,
  input: StartDeliveryAttemptInput,
  dependencies: StartAttemptDependencies = {},
): Promise<StartedDeliveryAttempt | null> {
  validateAttemptNumber(input.attemptNo)

  const createId = dependencies.createId ?? createPrefixedId

  const row = await database
    .prepare(
      `INSERT INTO delivery_attempts (
         id,
         delivery_id,
         attempt_no,
         state,
         request_started_at,
         created_at,
         lease_token,
         webhook_id
       )
       SELECT
         ?,
         deliveries.id,
         ?,
         'started',
         ?,
         ?,
         ?,
         ?
       FROM deliveries
       WHERE deliveries.id = ?
         AND deliveries.status = 'leased'
         AND deliveries.lease_token = ?
       ON CONFLICT (delivery_id, attempt_no)
       DO UPDATE SET
         state = 'started',
         outcome = NULL,
         request_started_at = excluded.request_started_at,
         completed_at = NULL,
         status_code = NULL,
         latency_ms = NULL,
         error_class = NULL,
         response_headers_json = NULL,
         response_excerpt = NULL,
         lease_token = excluded.lease_token,
         webhook_id = excluded.webhook_id
       WHERE delivery_attempts.state = 'started'
       RETURNING
         id,
         delivery_id,
         attempt_no,
         lease_token,
         webhook_id,
         request_started_at`,
    )
    .bind(
      createId('att'),
      input.attemptNo,
      input.requestStartedAt,
      input.requestStartedAt,
      input.leaseToken,
      input.webhookId,
      input.deliveryId,
      input.leaseToken,
    )
    .first<AttemptRow>()

  if (!row) {
    return null
  }

  return {
    id: row.id,
    deliveryId: row.delivery_id,
    attemptNo: row.attempt_no,
    leaseToken: row.lease_token,
    webhookId: row.webhook_id,
    requestStartedAt: row.request_started_at,
  }
}

export async function completeDeliveryAttempt(
  database: RelayDatabase,
  input: CompleteDeliveryAttemptInput,
): Promise<boolean> {
  validateAttemptNumber(input.attemptNo)

  const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS

  validateMaxAttempts(maxAttempts)

  const statusCode = input.statusCode ?? null
  const latencyMs = input.latencyMs ?? null

  validateEvidence(statusCode, latencyMs)

  const retryable =
    input.outcome === 'transient_failure' ||
    input.outcome === 'timeout' ||
    input.outcome === 'network_error'

  const exhausted =
    input.outcome === 'permanent_failure' || (retryable && input.attemptNo >= maxAttempts)

  const succeeded = input.outcome === 'success'

  if (retryable && !exhausted && !input.retryAt) {
    throw new TypeError('Retryable attempts require a retry timestamp.')
  }

  const deliveryStatus = succeeded ? 'delivered' : exhausted ? 'exhausted' : 'retrying'

  const nextAttemptAt = deliveryStatus === 'retrying' ? input.retryAt! : input.completedAt

  const responseHeadersJson =
    input.responseHeaders === null || input.responseHeaders === undefined
      ? null
      : canonicalizeJson({
          ...input.responseHeaders,
        })

  const statements: RelayStatement[] = [
    database
      .prepare(
        `UPDATE delivery_attempts
         SET state = 'completed',
             outcome = ?,
             completed_at = ?,
             status_code = ?,
             latency_ms = ?,
             error_class = ?,
             response_headers_json = ?,
             response_excerpt = ?
         WHERE delivery_id = ?
           AND attempt_no = ?
           AND state = 'started'
           AND lease_token = ?
           AND EXISTS (
             SELECT 1
             FROM deliveries
             WHERE deliveries.id = ?
               AND deliveries.status = 'leased'
               AND deliveries.lease_token = ?
           )`,
      )
      .bind(
        input.outcome,
        input.completedAt,
        statusCode,
        latencyMs,
        input.errorClass ?? null,
        responseHeadersJson,
        input.responseExcerpt?.slice(0, 2000) ?? null,
        input.deliveryId,
        input.attemptNo,
        input.leaseToken,
        input.deliveryId,
        input.leaseToken,
      ),

    database
      .prepare(
        `UPDATE deliveries
         SET status = ?,
             attempt_count = ?,
             next_attempt_at = ?,
             lease_token = NULL,
             lease_expires_at = NULL,
             last_error_class = ?,
             updated_at = ?,
             delivered_at = ?,
             exhausted_at = ?
         WHERE id = ?
           AND status = 'leased'
           AND lease_token = ?`,
      )
      .bind(
        deliveryStatus,
        input.attemptNo,
        nextAttemptAt,
        succeeded ? null : (input.errorClass ?? input.outcome),
        input.completedAt,
        succeeded ? input.completedAt : null,
        exhausted ? input.completedAt : null,
        input.deliveryId,
        input.leaseToken,
      ),
  ]

  await database.batch(statements)

  const completed = await database
    .prepare(
      `SELECT
         state,
         outcome,
         completed_at,
         lease_token
       FROM delivery_attempts
       WHERE delivery_id = ?
         AND attempt_no = ?
       LIMIT 1`,
    )
    .bind(input.deliveryId, input.attemptNo)
    .first<CompletedAttemptRow>()

  return (
    completed?.state === 'completed' &&
    completed.outcome === input.outcome &&
    completed.completed_at === input.completedAt &&
    completed.lease_token === input.leaseToken
  )
}
