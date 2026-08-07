import { canonicalizeJson } from './canonical-json.js'
import { sha256Hex } from './auth.js'
import type { RelayDatabase } from './database.js'
import type { RelayIdPrefix } from './ids.js'
import { createPrefixedId } from './ids.js'
import { executeWebhook } from './webhook-executor.js'
import { createWebhookHeaders } from './webhook-signing.js'

const VERIFICATION_CHALLENGE_BYTES = 32
const VERIFICATION_TTL_MS = 5 * 60 * 1000

interface EndpointRow {
  id: string
  url: string
  status: string
}

export interface EndpointVerificationDependencies {
  createChallenge?: () => string
  createId?: (prefix: RelayIdPrefix) => string
  fetcher?: typeof fetch
  nowMilliseconds?: () => number
  timeoutMs?: number
}

export type EndpointVerificationResult =
  | {
      kind: 'verified'
      endpointId: string
      verifiedAt: string
    }
  | {
      kind: 'missing'
    }
  | {
      kind: 'ineligible'
      status: string
    }
  | {
      kind: 'failed'
      reason:
        | 'http_status'
        | 'challenge_mismatch'
        | 'timeout'
        | 'network_error'
        | 'expired'
        | 'stale_challenge'
      statusCode: number | null
    }

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function createVerificationChallenge(): string {
  const bytes = new Uint8Array(VERIFICATION_CHALLENGE_BYTES)
  crypto.getRandomValues(bytes)

  return `rly_verify_${bytesToHex(bytes)}`
}

async function buildVerificationRequest(
  endpoint: EndpointRow,
  challenge: string,
  signingSecret: string,
  timestampMs: number,
): Promise<Request> {
  const timestampSeconds = Math.floor(timestampMs / 1000)
  const timestamp = new Date(timestampMs).toISOString()
  const messageId = `msg_verify_${endpoint.id.slice(3)}_` + challenge.slice(-16)

  const rawBody = JSON.stringify({
    id: messageId,
    type: 'relay.endpoint_verification',
    timestamp,
    data: {
      challenge,
    },
  })

  const headers = await createWebhookHeaders({
    messageId,
    timestamp: timestampSeconds,
    rawBody,
    secret: signingSecret,
  })

  return new Request(endpoint.url, {
    method: 'POST',
    headers,
    body: rawBody,
    redirect: 'manual',
  })
}

async function recordFailure(
  database: RelayDatabase,
  endpointId: string,
  challengeHash: string,
  failedAt: string,
  reason: string,
  statusCode: number | null,
  createId: (prefix: RelayIdPrefix) => string,
): Promise<void> {
  const metadata: Record<string, string | number> = {
    reason,
  }

  if (statusCode !== null) {
    metadata.statusCode = statusCode
  }

  await database.batch([
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
         SELECT
           ?,
           'owner',
           'endpoint.verification_failed',
           'endpoint',
           ?,
           ?,
           ?
         WHERE EXISTS (
           SELECT 1
           FROM endpoints
           WHERE id = ?
             AND status = 'pending'
             AND verification_challenge_hash = ?
         )`,
      )
      .bind(
        createId('aud'),
        endpointId,
        canonicalizeJson(metadata),
        failedAt,
        endpointId,
        challengeHash,
      ),

    database
      .prepare(
        `UPDATE endpoints
         SET verification_challenge_hash = NULL,
             verification_expires_at = NULL,
             updated_at = ?
         WHERE id = ?
           AND status = 'pending'
           AND verification_challenge_hash = ?`,
      )
      .bind(failedAt, endpointId, challengeHash),
  ])
}

export async function verifyEndpoint(
  database: RelayDatabase,
  endpointId: string,
  signingSecret: string,
  dependencies: EndpointVerificationDependencies = {},
): Promise<EndpointVerificationResult> {
  const endpoint = await database
    .prepare(
      `SELECT id, url, status
       FROM endpoints
       WHERE id = ?
       LIMIT 1`,
    )
    .bind(endpointId)
    .first<EndpointRow>()

  if (!endpoint) {
    return { kind: 'missing' }
  }

  if (endpoint.status !== 'pending') {
    return {
      kind: 'ineligible',
      status: endpoint.status,
    }
  }

  const nowMilliseconds = dependencies.nowMilliseconds ?? Date.now
  const createChallenge = dependencies.createChallenge ?? createVerificationChallenge
  const createId = dependencies.createId ?? createPrefixedId

  const startedAtMs = nowMilliseconds()
  const startedAt = new Date(startedAtMs).toISOString()
  const expiresAtMs = startedAtMs + VERIFICATION_TTL_MS
  const expiresAt = new Date(expiresAtMs).toISOString()
  const challenge = createChallenge()
  const challengeHash = await sha256Hex(challenge)

  const claimed = await database
    .prepare(
      `UPDATE endpoints
       SET verification_challenge_hash = ?,
           verification_expires_at = ?,
           verification_attempted_at = ?,
           updated_at = ?
       WHERE id = ?
         AND status = 'pending'
       RETURNING id`,
    )
    .bind(challengeHash, expiresAt, startedAt, startedAt, endpointId)
    .first<{ id: string }>()

  if (!claimed) {
    return {
      kind: 'ineligible',
      status: endpoint.status,
    }
  }

  const request = await buildVerificationRequest(endpoint, challenge, signingSecret, startedAtMs)

  const executionInput =
    dependencies.timeoutMs === undefined
      ? { request }
      : {
          request,
          timeoutMs: dependencies.timeoutMs,
        }

  const executionDependencies =
    dependencies.fetcher === undefined
      ? { nowMilliseconds }
      : {
          fetcher: dependencies.fetcher,
          nowMilliseconds,
        }

  const execution = await executeWebhook(executionInput, executionDependencies)

  const completedAtMs = nowMilliseconds()
  const completedAt = new Date(completedAtMs).toISOString()

  if (completedAtMs > expiresAtMs) {
    await recordFailure(database, endpointId, challengeHash, completedAt, 'expired', null, createId)

    return {
      kind: 'failed',
      reason: 'expired',
      statusCode: null,
    }
  }

  if (execution.kind !== 'response') {
    const reason = execution.kind === 'timeout' ? 'timeout' : 'network_error'

    await recordFailure(database, endpointId, challengeHash, completedAt, reason, null, createId)

    return {
      kind: 'failed',
      reason,
      statusCode: null,
    }
  }

  if (execution.statusCode !== 200) {
    await recordFailure(
      database,
      endpointId,
      challengeHash,
      completedAt,
      'http_status',
      execution.statusCode,
      createId,
    )

    return {
      kind: 'failed',
      reason: 'http_status',
      statusCode: execution.statusCode,
    }
  }

  if (execution.responseHeaders['x-relay-challenge'] !== challenge) {
    await recordFailure(
      database,
      endpointId,
      challengeHash,
      completedAt,
      'challenge_mismatch',
      execution.statusCode,
      createId,
    )

    return {
      kind: 'failed',
      reason: 'challenge_mismatch',
      statusCode: execution.statusCode,
    }
  }

  await database.batch([
    database
      .prepare(
        `UPDATE endpoints
         SET status = 'active',
             verified_at = ?,
             verification_challenge_hash = NULL,
             verification_expires_at = NULL,
             updated_at = ?
         WHERE id = ?
           AND status = 'pending'
           AND verification_challenge_hash = ?
           AND verification_expires_at >= ?`,
      )
      .bind(completedAt, completedAt, endpointId, challengeHash, completedAt),

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
         SELECT
           ?,
           'owner',
           'endpoint.verified',
           'endpoint',
           ?,
           ?,
           ?
         WHERE EXISTS (
           SELECT 1
           FROM endpoints
           WHERE id = ?
             AND status = 'active'
             AND verified_at = ?
         )`,
      )
      .bind(
        createId('aud'),
        endpointId,
        canonicalizeJson({
          method: 'challenge_response',
        }),
        completedAt,
        endpointId,
        completedAt,
      ),
  ])

  const verified = await database
    .prepare(
      `SELECT status, verified_at
       FROM endpoints
       WHERE id = ?
       LIMIT 1`,
    )
    .bind(endpointId)
    .first<{
      status: string
      verified_at: string | null
    }>()

  if (verified?.status !== 'active' || verified.verified_at !== completedAt) {
    return {
      kind: 'failed',
      reason: 'stale_challenge',
      statusCode: 200,
    }
  }

  return {
    kind: 'verified',
    endpointId,
    verifiedAt: completedAt,
  }
}
