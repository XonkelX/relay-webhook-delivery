import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { completeDeliveryAttempt, startDeliveryAttempt } from '../worker/lib/delivery-attempt.js'
import { claimDelivery } from '../worker/lib/delivery-claim.js'
import { createWebhookId } from '../worker/lib/webhook-request.js'

const createdAt = '2026-08-05T21:30:00.000Z'

describe('D1 delivery attempt lifecycle', () => {
  it('records a retry followed by successful delivery', async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO api_keys (
             id,
             name,
             key_prefix,
             secret_hash,
             status,
             created_at
           )
           VALUES (?, ?, ?, ?, 'active', ?)`,
      ).bind('key_attempt', 'Attempt test', 'rly_attempt_test', 'a'.repeat(64), createdAt),

      env.DB.prepare(
        `INSERT INTO endpoints (
             id,
             name,
             url,
             status,
             created_at,
             updated_at,
             verified_at
           )
           VALUES (?, ?, ?, 'active', ?, ?, ?)`,
      ).bind(
        'ep_attempt',
        'Attempt endpoint',
        'https://example.test/attempt',
        createdAt,
        createdAt,
        createdAt,
      ),

      env.DB.prepare(
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
      ).bind(
        'evt_attempt',
        'key_attempt',
        'attempt-request',
        'attempt.test',
        '{}',
        'b'.repeat(64),
        2,
        createdAt,
      ),

      env.DB.prepare(
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
      ).bind('dlv_attempt', 'evt_attempt', 'ep_attempt', createdAt, createdAt, createdAt),
    ])

    const firstClaim = await claimDelivery(env.DB, 'dlv_attempt', 30, {
      now: () => createdAt,
      createLeaseToken: () => 'lease_attempt_1',
    })

    expect(firstClaim.ok).toBe(true)

    if (!firstClaim.ok) {
      throw new Error('Expected the first claim to succeed.')
    }

    const webhookId = createWebhookId('dlv_attempt')

    await expect(
      startDeliveryAttempt(
        env.DB,
        {
          deliveryId: 'dlv_attempt',
          attemptNo: firstClaim.value.attemptNo,
          leaseToken: firstClaim.value.leaseToken,
          webhookId,
          requestStartedAt: createdAt,
        },
        {
          createId: () => 'att_attempt_1',
        },
      ),
    ).resolves.toMatchObject({
      id: 'att_attempt_1',
      attemptNo: 1,
      webhookId,
    })

    await expect(
      completeDeliveryAttempt(env.DB, {
        deliveryId: 'dlv_attempt',
        attemptNo: 1,
        leaseToken: 'lease_attempt_1',
        outcome: 'transient_failure',
        completedAt: '2026-08-05T21:30:01.000Z',
        retryAt: '2026-08-05T21:31:00.000Z',
        statusCode: 503,
        latencyMs: 1000,
        errorClass: 'http_503',
        responseHeaders: {
          authorization: 'Bearer persisted-secret',
          'retry-after': '59',
          'set-cookie': 'session=persisted-secret',
          'x-api-key': 'persisted-api-secret',
          'x-request-id': 'req_persisted',
          'x-untrusted-header': 'must-not-be-persisted',
        },
        responseExcerpt: 'temporarily unavailable',
      }),
    ).resolves.toBe(true)

    const persistedEvidence = await env.DB.prepare(
      `SELECT response_headers_json
         FROM delivery_attempts
         WHERE delivery_id = ?
           AND attempt_no = 1`,
    )
      .bind('dlv_attempt')
      .first<{ response_headers_json: string | null }>()

    expect(persistedEvidence?.response_headers_json).not.toBeNull()

    expect(JSON.parse(persistedEvidence?.response_headers_json ?? '{}')).toEqual({
      authorization: '[REDACTED]',
      'retry-after': '59',
      'set-cookie': '[REDACTED]',
      'x-api-key': '[REDACTED]',
      'x-request-id': 'req_persisted',
    })

    const retrying = await env.DB.prepare(
      `SELECT
           status,
           attempt_count,
           next_attempt_at,
           lease_token
         FROM deliveries
         WHERE id = ?`,
    )
      .bind('dlv_attempt')
      .first<{
        status: string
        attempt_count: number
        next_attempt_at: string
        lease_token: string | null
      }>()

    expect(retrying).toEqual({
      status: 'retrying',
      attempt_count: 1,
      next_attempt_at: '2026-08-05T21:31:00.000Z',
      lease_token: null,
    })

    const secondClaim = await claimDelivery(env.DB, 'dlv_attempt', 30, {
      now: () => '2026-08-05T21:31:00.000Z',
      createLeaseToken: () => 'lease_attempt_2',
    })

    expect(secondClaim.ok).toBe(true)

    if (!secondClaim.ok) {
      throw new Error('Expected the retry claim to succeed.')
    }

    await startDeliveryAttempt(
      env.DB,
      {
        deliveryId: 'dlv_attempt',
        attemptNo: secondClaim.value.attemptNo,
        leaseToken: secondClaim.value.leaseToken,
        webhookId,
        requestStartedAt: '2026-08-05T21:31:00.000Z',
      },
      {
        createId: () => 'att_attempt_2',
      },
    )

    await expect(
      completeDeliveryAttempt(env.DB, {
        deliveryId: 'dlv_attempt',
        attemptNo: 2,
        leaseToken: 'lease_attempt_2',
        outcome: 'success',
        completedAt: '2026-08-05T21:31:00.250Z',
        statusCode: 204,
        latencyMs: 250,
      }),
    ).resolves.toBe(true)

    const delivered = await env.DB.prepare(
      `SELECT
           status,
           attempt_count,
           lease_token,
           delivered_at,
           exhausted_at
         FROM deliveries
         WHERE id = ?`,
    )
      .bind('dlv_attempt')
      .first<{
        status: string
        attempt_count: number
        lease_token: string | null
        delivered_at: string | null
        exhausted_at: string | null
      }>()

    expect(delivered).toEqual({
      status: 'delivered',
      attempt_count: 2,
      lease_token: null,
      delivered_at: '2026-08-05T21:31:00.250Z',
      exhausted_at: null,
    })

    const attempts = await env.DB.prepare(
      `SELECT
           attempt_no,
           state,
           outcome,
           webhook_id
         FROM delivery_attempts
         WHERE delivery_id = ?
         ORDER BY attempt_no`,
    )
      .bind('dlv_attempt')
      .all<{
        attempt_no: number
        state: string
        outcome: string
        webhook_id: string
      }>()

    expect(attempts.results).toEqual([
      {
        attempt_no: 1,
        state: 'completed',
        outcome: 'transient_failure',
        webhook_id: webhookId,
      },
      {
        attempt_no: 2,
        state: 'completed',
        outcome: 'success',
        webhook_id: webhookId,
      },
    ])
  })
})
