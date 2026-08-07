import { env } from 'cloudflare:workers'
import { describe, expect, it, vi } from 'vitest'
import { processDeliveryMessage } from '../worker/lib/delivery-processor.js'

const now = '2026-08-06T23:00:00.000Z'
const nowMs = Date.parse(now)
const deliveryId = 'dlv_66666666666666666666666666666666'

describe('D1 delivery exhaustion', () => {
  it('exhausts at the configured maximum without rearming the outbox', async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO api_keys (
             id, name, key_prefix, secret_hash,
             status, created_at
           )
           VALUES (?, ?, ?, ?, 'active', ?)`,
      ).bind('key_exhaust', 'Exhaustion test', 'rly_exhaust_key', 'a'.repeat(64), now),

      env.DB.prepare(
        `INSERT INTO endpoints (
             id, name, url, status,
             created_at, updated_at, verified_at
           )
           VALUES (?, ?, ?, 'active', ?, ?, ?)`,
      ).bind('ep_exhaust', 'Exhaust endpoint', 'https://example.test/exhaust', now, now, now),

      env.DB.prepare(
        `INSERT INTO events (
             id, api_key_id, idempotency_key,
             event_type, payload_json,
             payload_sha256, payload_bytes,
             created_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        'evt_exhaust',
        'key_exhaust',
        'exhaust-request',
        'delivery.exhaust',
        '{}',
        'b'.repeat(64),
        2,
        now,
      ),

      env.DB.prepare(
        `INSERT INTO deliveries (
             id, event_id, endpoint_id,
             status, attempt_count, next_attempt_at,
             created_at, updated_at
           )
           VALUES (?, ?, ?, 'retrying', 1, ?, ?, ?)`,
      ).bind(deliveryId, 'evt_exhaust', 'ep_exhaust', now, now, now),

      env.DB.prepare(
        `INSERT INTO delivery_outbox (
             id, delivery_id, available_at,
             published_at, publish_attempts,
             reason, created_at
           )
           VALUES (?, ?, ?, ?, 2, 'retry', ?)`,
      ).bind('out_exhaust', deliveryId, now, now, now),
    ])

    const fetcher = vi.fn(
      async () =>
        new Response('still unavailable', {
          status: 503,
        }),
    ) as typeof fetch

    await expect(
      processDeliveryMessage(
        env.DB,
        {
          version: 1,
          deliveryId,
          reason: 'retry',
        },
        {
          resolveSigningSecret: async () => 'exhaust_secret',
          fetcher,
          nowMilliseconds: () => nowMs,
          random: () => 0,
          createLeaseToken: () => 'lease_exhaust',
          createAttemptId: () => 'att_exhaust_second',
          maxAttempts: 2,
        },
      ),
    ).resolves.toMatchObject({
      action: 'ack',
      reason: 'completed',
      outcome: 'transient_failure',
    })

    const delivery = await env.DB.prepare(
      `SELECT
           status,
           attempt_count,
           exhausted_at,
           lease_token
         FROM deliveries
         WHERE id = ?`,
    )
      .bind(deliveryId)
      .first<{
        status: string
        attempt_count: number
        exhausted_at: string | null
        lease_token: string | null
      }>()

    expect(delivery).toEqual({
      status: 'exhausted',
      attempt_count: 2,
      exhausted_at: now,
      lease_token: null,
    })

    const outbox = await env.DB.prepare(
      `SELECT
           reason,
           published_at,
           publish_attempts
         FROM delivery_outbox
         WHERE delivery_id = ?`,
    )
      .bind(deliveryId)
      .first<{
        reason: string
        published_at: string | null
        publish_attempts: number
      }>()

    expect(outbox).toEqual({
      reason: 'retry',
      published_at: now,
      publish_attempts: 2,
    })
  })
})
