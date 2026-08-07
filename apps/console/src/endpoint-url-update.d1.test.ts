import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { createEndpoint, updateEndpointUrl } from '../worker/lib/endpoint-persistence.js'
import { TEST_ENDPOINT_CRYPTO_DEPENDENCIES } from './test-endpoint-secret.js'

const now = '2026-08-07T04:00:00.000Z'
const updatedAt = '2026-08-07T04:15:00.000Z'

describe('D1 endpoint URL updates', () => {
  it('requires re-verification and cancels scheduled work', async () => {
    const endpoint = await createEndpoint(
      env.DB,
      {
        name: 'URL change endpoint',
        url: 'https://old-target.example.test/webhook',
        eventTypes: [],
      },
      {
        ...TEST_ENDPOINT_CRYPTO_DEPENDENCIES,
        now: () => now,
        createId: (prefix) => `${prefix}_url_change`,
      },
    )

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE endpoints
           SET status = 'active',
               verified_at = ?,
               verification_challenge_hash = ?,
               verification_expires_at = ?,
               verification_attempted_at = ?
           WHERE id = ?`,
      ).bind(now, 'd'.repeat(64), '2026-08-07T04:05:00.000Z', now, endpoint.id),

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
      ).bind('key_url_change', 'URL change test', 'rly_urlchange', 'e'.repeat(64), now),

      ...[
        ['queued', 0],
        ['retrying', 1],
      ].flatMap(([status, attemptCount]) => {
        const suffix = String(status)

        return [
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
            `evt_url_${suffix}`,
            'key_url_change',
            `url-change-${suffix}`,
            'endpoint.url.changed',
            '{"safe":true}',
            suffix === 'queued' ? 'f'.repeat(64) : 'a'.repeat(64),
            13,
            now,
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
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            `dlv_url_${suffix}`,
            `evt_url_${suffix}`,
            endpoint.id,
            status,
            attemptCount,
            '2026-08-07T05:00:00.000Z',
            now,
            now,
          ),

          env.DB.prepare(
            `INSERT INTO delivery_outbox (
                 id,
                 delivery_id,
                 available_at,
                 published_at,
                 publish_attempts,
                 reason,
                 created_at
               )
               VALUES (?, ?, ?, NULL, 0, ?, ?)`,
          ).bind(
            `out_url_${suffix}`,
            `dlv_url_${suffix}`,
            '2026-08-07T05:00:00.000Z',
            status === 'queued' ? 'initial' : 'retry',
            now,
          ),
        ]
      }),
    ])

    await expect(
      updateEndpointUrl(env.DB, endpoint.id, 'https://NEW-target.example.test/webhook', {
        now: () => updatedAt,
        createId: () => 'aud_url_change_updated',
      }),
    ).resolves.toEqual({
      updated: true,
      url: 'https://new-target.example.test/webhook',
      status: 'pending',
    })

    const storedEndpoint = await env.DB.prepare(
      `SELECT
           url,
           status,
           verified_at,
           verification_challenge_hash,
           verification_expires_at,
           verification_attempted_at
         FROM endpoints
         WHERE id = ?`,
    )
      .bind(endpoint.id)
      .first<{
        url: string
        status: string
        verified_at: string | null
        verification_challenge_hash: string | null
        verification_expires_at: string | null
        verification_attempted_at: string | null
      }>()

    expect(storedEndpoint).toEqual({
      url: 'https://new-target.example.test/webhook',
      status: 'pending',
      verified_at: null,
      verification_challenge_hash: null,
      verification_expires_at: null,
      verification_attempted_at: null,
    })

    const deliveries = await env.DB.prepare(
      `SELECT status, last_error_class
         FROM deliveries
         WHERE endpoint_id = ?
         ORDER BY id`,
    )
      .bind(endpoint.id)
      .all<{
        status: string
        last_error_class: string | null
      }>()

    expect(deliveries.results).toEqual([
      {
        status: 'cancelled',
        last_error_class: 'endpoint_url_changed',
      },
      {
        status: 'cancelled',
        last_error_class: 'endpoint_url_changed',
      },
    ])

    const pendingOutbox = await env.DB.prepare(
      `SELECT COUNT(*) AS count
         FROM delivery_outbox
         WHERE delivery_id IN (
           'dlv_url_queued',
           'dlv_url_retrying'
         )`,
    ).first<{ count: number }>()

    expect(pendingOutbox?.count).toBe(0)
  })
})
