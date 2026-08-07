import { env } from 'cloudflare:workers'
import { describe, expect, it, vi } from 'vitest'
import { processDeliveryMessage } from '../worker/lib/delivery-processor.js'

const now = '2026-08-07T03:30:00.000Z'
const nowMs = Date.parse(now)

describe('D1 delivery endpoint execution gate', () => {
  it.each([
    ['pending', null],
    ['paused', null],
    ['disabled', now],
  ] as const)('cancels queued work when endpoint is %s', async (status, disabledAt) => {
    const suffix = status

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO api_keys (
               id, name, key_prefix, secret_hash,
               status, created_at
             )
             VALUES (?, ?, ?, ?, 'active', ?)`,
      ).bind(
        `key_gate_${suffix}`,
        `Gate ${suffix}`,
        `rly_gate_${suffix}`,
        (status === 'pending' ? 'a' : status === 'paused' ? 'b' : 'c').repeat(64),
        now,
      ),

      env.DB.prepare(
        `INSERT INTO endpoints (
               id, name, url, status,
               created_at, updated_at,
               verified_at, disabled_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        `ep_gate_${suffix}`,
        `Gate ${suffix}`,
        `https://gate-${suffix}.example.test/webhook`,
        status,
        now,
        now,
        status === 'pending' ? null : now,
        disabledAt,
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
        `evt_gate_${suffix}`,
        `key_gate_${suffix}`,
        `gate-${suffix}`,
        'gate.test',
        '{"safe":true}',
        'b'.repeat(64),
        13,
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
      ).bind(`dlv_gate_${suffix}`, `evt_gate_${suffix}`, `ep_gate_${suffix}`, now, now, now),
    ])

    const fetcher = vi.fn()
    const resolveSigningSecrets = vi.fn()

    await expect(
      processDeliveryMessage(
        env.DB,
        {
          version: 1,
          deliveryId: `dlv_gate_${suffix}`,
          reason: 'initial',
        },
        {
          resolveSigningSecrets,
          fetcher: fetcher as typeof fetch,
          nowMilliseconds: () => nowMs,
          createLeaseToken: () => `lease_gate_${suffix}`,
        },
      ),
    ).resolves.toEqual({
      action: 'ack',
      reason: 'cancelled',
    })

    expect(resolveSigningSecrets).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()

    const delivery = await env.DB.prepare(
      `SELECT
             status,
             attempt_count,
             lease_token,
             last_error_class
           FROM deliveries
           WHERE id = ?`,
    )
      .bind(`dlv_gate_${suffix}`)
      .first<{
        status: string
        attempt_count: number
        lease_token: string | null
        last_error_class: string | null
      }>()

    expect(delivery).toEqual({
      status: 'cancelled',
      attempt_count: 0,
      lease_token: null,
      last_error_class: 'endpoint_inactive',
    })

    const attempts = await env.DB.prepare(
      `SELECT COUNT(*) AS count
           FROM delivery_attempts
           WHERE delivery_id = ?`,
    )
      .bind(`dlv_gate_${suffix}`)
      .first<{ count: number }>()

    expect(attempts?.count).toBe(0)
  })
})
