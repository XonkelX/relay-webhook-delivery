import { env } from 'cloudflare:workers'
import { describe, expect, it, vi } from 'vitest'
import { processDeliveryMessage } from '../worker/lib/delivery-processor.js'

const startTime = Date.parse('2026-08-06T21:00:00.000Z')

describe('D1 delivery retry roundtrip', () => {
  it('retries 503 to success with a stable webhook ID and ignores duplicates', async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO api_keys (
             id, name, key_prefix, secret_hash,
             status, created_at
           )
           VALUES (?, ?, ?, ?, 'active', ?)`,
      ).bind(
        'key_retry_roundtrip',
        'Retry roundtrip',
        'rly_roundtrip12',
        'a'.repeat(64),
        '2026-08-06T21:00:00.000Z',
      ),

      env.DB.prepare(
        `INSERT INTO endpoints (
             id, name, url, status,
             created_at, updated_at, verified_at
           )
           VALUES (?, ?, ?, 'active', ?, ?, ?)`,
      ).bind(
        'ep_retry_roundtrip',
        'Retry endpoint',
        'https://example.test/retry-roundtrip',
        '2026-08-06T21:00:00.000Z',
        '2026-08-06T21:00:00.000Z',
        '2026-08-06T21:00:00.000Z',
      ),

      env.DB.prepare(
        `INSERT INTO events (
             id, api_key_id, idempotency_key,
             event_type, payload_json,
             payload_sha256, payload_bytes,
             created_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        'evt_retry_roundtrip',
        'key_retry_roundtrip',
        'retry-roundtrip',
        'invoice.retry',
        '{"invoiceId":"inv_retry"}',
        'b'.repeat(64),
        31,
        '2026-08-06T21:00:00.000Z',
      ),

      env.DB.prepare(
        `INSERT INTO deliveries (
             id, event_id, endpoint_id,
             status, attempt_count, next_attempt_at,
             created_at, updated_at
           )
           VALUES (?, ?, ?, 'queued', 0, ?, ?, ?)`,
      ).bind(
        'dlv_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'evt_retry_roundtrip',
        'ep_retry_roundtrip',
        '2026-08-06T21:00:00.000Z',
        '2026-08-06T21:00:00.000Z',
        '2026-08-06T21:00:00.000Z',
      ),

      env.DB.prepare(
        `INSERT INTO delivery_outbox (
             id, delivery_id, available_at,
             published_at, publish_attempts,
             reason, created_at
           )
           VALUES (?, ?, ?, ?, 1, 'initial', ?)`,
      ).bind(
        'out_retry_roundtrip',
        'dlv_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '2026-08-06T21:00:00.000Z',
        '2026-08-06T21:00:00.000Z',
        '2026-08-06T21:00:00.000Z',
      ),
    ])

    let currentTime = startTime
    let call = 0
    const webhookIds: string[] = []

    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input)

      webhookIds.push(request.headers.get('webhook-id') ?? '')

      call += 1

      if (call === 1) {
        return new Response('temporary failure', {
          status: 503,
          headers: {
            'retry-after': '60',
          },
        })
      }

      return new Response(null, {
        status: 200,
      })
    }) as typeof fetch

    let lease = 0
    let attempt = 0

    const dependencies = {
      resolveSigningSecrets: async () => ['roundtrip_secret'],
      fetcher,
      nowMilliseconds: () => currentTime,
      random: () => 0,
      createLeaseToken: () => `lease_roundtrip_${++lease}`,
      createAttemptId: () => `att_roundtrip_${++attempt}`,
    }

    await expect(
      processDeliveryMessage(
        env.DB,
        {
          version: 1,
          deliveryId: 'dlv_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          reason: 'initial',
        },
        dependencies,
      ),
    ).resolves.toMatchObject({
      action: 'ack',
      reason: 'completed',
      outcome: 'transient_failure',
    })

    const retryState = await env.DB.prepare(
      `SELECT status, attempt_count, next_attempt_at
         FROM deliveries
         WHERE id = ?`,
    )
      .bind('dlv_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
      .first<{
        status: string
        attempt_count: number
        next_attempt_at: string
      }>()

    expect(retryState).toEqual({
      status: 'retrying',
      attempt_count: 1,
      next_attempt_at: '2026-08-06T21:01:00.000Z',
    })

    currentTime += 60_000

    await env.DB.prepare(
      `UPDATE delivery_outbox
         SET published_at = ?,
             publish_attempts = publish_attempts + 1
         WHERE delivery_id = ?`,
    )
      .bind('2026-08-06T21:01:00.000Z', 'dlv_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
      .run()

    await expect(
      processDeliveryMessage(
        env.DB,
        {
          version: 1,
          deliveryId: 'dlv_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          reason: 'retry',
        },
        dependencies,
      ),
    ).resolves.toMatchObject({
      action: 'ack',
      reason: 'completed',
      outcome: 'success',
    })

    expect(webhookIds).toEqual([
      'msg_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'msg_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    ])

    const delivered = await env.DB.prepare(
      `SELECT status, attempt_count
         FROM deliveries
         WHERE id = ?`,
    )
      .bind('dlv_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
      .first<{
        status: string
        attempt_count: number
      }>()

    expect(delivered).toEqual({
      status: 'delivered',
      attempt_count: 2,
    })

    await expect(
      processDeliveryMessage(
        env.DB,
        {
          version: 1,
          deliveryId: 'dlv_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          reason: 'retry',
        },
        dependencies,
      ),
    ).resolves.toEqual({
      action: 'ack',
      reason: 'terminal',
    })

    expect(fetcher).toHaveBeenCalledTimes(2)

    const attempts = await env.DB.prepare(
      `SELECT attempt_no, outcome, webhook_id
         FROM delivery_attempts
         WHERE delivery_id = ?
         ORDER BY attempt_no`,
    )
      .bind('dlv_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
      .all<{
        attempt_no: number
        outcome: string
        webhook_id: string
      }>()

    expect(attempts.results).toEqual([
      {
        attempt_no: 1,
        outcome: 'transient_failure',
        webhook_id: 'msg_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
      {
        attempt_no: 2,
        outcome: 'success',
        webhook_id: 'msg_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    ])
  })
})
