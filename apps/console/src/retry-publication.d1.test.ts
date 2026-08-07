import { env } from 'cloudflare:workers'
import { describe, expect, it, vi } from 'vitest'
import { publishPendingOutbox } from '../worker/lib/outbox-publisher.js'

const now = '2026-08-06T23:30:00.000Z'

describe('D1 retry outbox publication', () => {
  it('publishes only due retry rows with the persisted retry reason', async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO api_keys (
             id, name, key_prefix, secret_hash,
             status, created_at
           )
           VALUES (?, ?, ?, ?, 'active', ?)`,
      ).bind('key_publish', 'Publish test', 'rly_publish_key', 'c'.repeat(64), now),

      env.DB.prepare(
        `INSERT INTO endpoints (
             id, name, url, status,
             created_at, updated_at, verified_at
           )
           VALUES (?, ?, ?, 'active', ?, ?, ?)`,
      ).bind('ep_publish', 'Publish endpoint', 'https://example.test/publish', now, now, now),

      ...[
        ['due', 'dlv_77777777777777777777777777777777', '2026-08-06T23:29:00.000Z'],
        ['future', 'dlv_88888888888888888888888888888888', '2026-08-06T23:31:00.000Z'],
      ].flatMap(([suffix, deliveryId, availableAt]) => [
        env.DB.prepare(
          `INSERT INTO events (
               id, api_key_id, idempotency_key,
               event_type, payload_json,
               payload_sha256, payload_bytes,
               created_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          `evt_publish_${suffix}`,
          'key_publish',
          `publish-${suffix}`,
          'delivery.publish',
          '{}',
          suffix === 'due' ? 'd'.repeat(64) : 'e'.repeat(64),
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
        ).bind(deliveryId, `evt_publish_${suffix}`, 'ep_publish', availableAt, now, now),

        env.DB.prepare(
          `INSERT INTO delivery_outbox (
               id, delivery_id, available_at,
               published_at, publish_attempts,
               reason, created_at
             )
             VALUES (?, ?, ?, NULL, 1, 'retry', ?)`,
        ).bind(`out_publish_${suffix}`, deliveryId, availableAt, now),
      ]),
    ])

    const send = vi.fn().mockResolvedValue(undefined)

    await expect(publishPendingOutbox(env.DB, { send }, 100, now)).resolves.toEqual({
      published: 1,
      failed: 0,
    })

    expect(send).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith(
      {
        version: 1,
        deliveryId: 'dlv_77777777777777777777777777777777',
        reason: 'retry',
      },
      {
        contentType: 'json',
      },
    )

    const rows = await env.DB.prepare(
      `SELECT id, published_at, publish_attempts
         FROM delivery_outbox
         WHERE id IN (
           'out_publish_due',
           'out_publish_future'
         )
         ORDER BY id`,
    ).all<{
      id: string
      published_at: string | null
      publish_attempts: number
    }>()

    expect(rows.results).toEqual([
      {
        id: 'out_publish_due',
        published_at: now,
        publish_attempts: 2,
      },
      {
        id: 'out_publish_future',
        published_at: null,
        publish_attempts: 1,
      },
    ])
  })
})
