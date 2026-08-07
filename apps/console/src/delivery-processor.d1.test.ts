import { env } from 'cloudflare:workers'
import { describe, expect, it, vi } from 'vitest'
import { processDeliveryMessage } from '../worker/lib/delivery-processor.js'

const now = '2026-08-06T20:00:00.000Z'
const nowMs = Date.parse(now)

describe('D1 delivery processor', () => {
  it('persists success, retry, and permanent failure', async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO api_keys (
             id, name, key_prefix, secret_hash,
             status, created_at
           )
           VALUES (?, ?, ?, ?, 'active', ?)`,
      ).bind('key_processor', 'Processor test', 'rly_processor12', 'a'.repeat(64), now),

      ...[
        ['success', 'https://example.test/success'],
        ['retry', 'https://example.test/retry'],
        ['gone', 'https://example.test/gone'],
      ].map(([suffix, url]) =>
        env.DB.prepare(
          `INSERT INTO endpoints (
               id, name, url, status,
               created_at, updated_at, verified_at
             )
             VALUES (?, ?, ?, 'active', ?, ?, ?)`,
        ).bind(`ep_${suffix}`, suffix, url, now, now, now),
      ),

      ...[
        ['success', 'ep_success'],
        ['retry', 'ep_retry'],
        ['gone', 'ep_gone'],
      ].flatMap(([suffix, endpointId]) => [
        env.DB.prepare(
          `INSERT INTO events (
               id, api_key_id, idempotency_key,
               event_type, payload_json,
               payload_sha256, payload_bytes,
               created_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          `evt_${suffix}`,
          'key_processor',
          `request-${suffix}`,
          'processor.test',
          '{"value":"test"}',
          'b'.repeat(64),
          16,
          now,
        ),

        env.DB.prepare(
          `INSERT INTO deliveries (
               id, event_id, endpoint_id,
               status, attempt_count,
               next_attempt_at,
               created_at, updated_at
             )
             VALUES (?, ?, ?, 'queued', 0, ?, ?, ?)`,
        ).bind(`dlv_${suffix}`, `evt_${suffix}`, endpointId, now, now, now),

        env.DB.prepare(
          `INSERT INTO delivery_outbox (
               id, delivery_id, available_at,
               published_at, publish_attempts,
               reason, created_at
             )
             VALUES (?, ?, ?, ?, 1, 'initial', ?)`,
        ).bind(`out_${suffix}`, `dlv_${suffix}`, now, now, now),
      ]),
    ])

    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input)

      if (url.endsWith('/success')) {
        return new Response(null, {
          status: 204,
        })
      }

      if (url.endsWith('/retry')) {
        return new Response('temporarily unavailable', {
          status: 503,
          headers: {
            'retry-after': '60',
          },
        })
      }

      return new Response('gone', {
        status: 410,
      })
    }) as typeof fetch

    let leaseSequence = 0
    let attemptSequence = 0

    const dependencies = {
      resolveSigningSecrets: async () => ['endpoint_secret'],
      fetcher,
      nowMilliseconds: () => nowMs,
      random: () => 0,
      createLeaseToken: () => `lease_processor_${++leaseSequence}`,
      createAttemptId: () => `att_processor_${++attemptSequence}`,
    }

    for (const deliveryId of ['dlv_success', 'dlv_retry', 'dlv_gone']) {
      await expect(
        processDeliveryMessage(
          env.DB,
          {
            version: 1,
            deliveryId,
            reason: 'initial',
          },
          dependencies,
        ),
      ).resolves.toMatchObject({
        action: 'ack',
        reason: 'completed',
      })
    }

    const deliveries = await env.DB.prepare(
      `SELECT id, status, attempt_count
         FROM deliveries
         ORDER BY id`,
    ).all<{
      id: string
      status: string
      attempt_count: number
    }>()

    expect(deliveries.results).toEqual([
      {
        id: 'dlv_gone',
        status: 'exhausted',
        attempt_count: 1,
      },
      {
        id: 'dlv_retry',
        status: 'retrying',
        attempt_count: 1,
      },
      {
        id: 'dlv_success',
        status: 'delivered',
        attempt_count: 1,
      },
    ])

    const retryOutbox = await env.DB.prepare(
      `SELECT reason, published_at, available_at
         FROM delivery_outbox
         WHERE delivery_id = ?`,
    )
      .bind('dlv_retry')
      .first<{
        reason: string
        published_at: string | null
        available_at: string
      }>()

    expect(retryOutbox).toEqual({
      reason: 'retry',
      published_at: null,
      available_at: '2026-08-06T20:01:00.000Z',
    })

    const attempts = await env.DB.prepare(
      `SELECT delivery_id, outcome, status_code
         FROM delivery_attempts
         ORDER BY delivery_id`,
    ).all<{
      delivery_id: string
      outcome: string
      status_code: number | null
    }>()

    expect(attempts.results).toEqual([
      {
        delivery_id: 'dlv_gone',
        outcome: 'permanent_failure',
        status_code: 410,
      },
      {
        delivery_id: 'dlv_retry',
        outcome: 'transient_failure',
        status_code: 503,
      },
      {
        delivery_id: 'dlv_success',
        outcome: 'success',
        status_code: 204,
      },
    ])
  })
})
