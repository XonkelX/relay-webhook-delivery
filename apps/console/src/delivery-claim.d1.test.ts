import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { claimDelivery } from '../worker/lib/delivery-claim.js'

const now = '2026-08-05T21:00:00.000Z'

describe('D1 delivery claims', () => {
  it('grants one lease for concurrent claims and rejects terminal work', async () => {
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
      ).bind('key_claim', 'Claim test', 'rly_claim_test12', 'a'.repeat(64), now),

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
      ).bind('ep_claim', 'Claim endpoint', 'https://example.test/claim', now, now, now),

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
      ).bind('evt_claim', 'key_claim', 'claim-request', 'claim.test', '{}', 'b'.repeat(64), 2, now),

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
      ).bind('dlv_claim', 'evt_claim', 'ep_claim', now, now, now),
    ])

    const results = await Promise.all([
      claimDelivery(env.DB, 'dlv_claim', 30, {
        now: () => now,
        createLeaseToken: () => 'lease_first',
      }),
      claimDelivery(env.DB, 'dlv_claim', 30, {
        now: () => now,
        createLeaseToken: () => 'lease_second',
      }),
    ])

    const claimed = results.filter((result) => result.ok)
    const rejected = results.filter((result) => !result.ok)

    expect(claimed).toHaveLength(1)
    expect(rejected).toHaveLength(1)

    expect(claimed[0]).toMatchObject({
      ok: true,
      value: {
        id: 'dlv_claim',
        eventId: 'evt_claim',
        endpointId: 'ep_claim',
        attemptNo: 1,
        leaseExpiresAt: '2026-08-05T21:00:30.000Z',
      },
    })

    expect(rejected[0]).toEqual({
      ok: false,
      reason: 'leased',
    })

    await env.DB.prepare(
      `UPDATE deliveries
         SET status = 'delivered',
             lease_token = NULL,
             lease_expires_at = NULL,
             delivered_at = ?,
             updated_at = ?
         WHERE id = ?`,
    )
      .bind(now, now, 'dlv_claim')
      .run()

    await expect(
      claimDelivery(env.DB, 'dlv_claim', 30, {
        now: () => now,
        createLeaseToken: () => 'lease_terminal',
      }),
    ).resolves.toEqual({
      ok: false,
      reason: 'terminal',
    })

    await expect(
      claimDelivery(env.DB, 'dlv_missing', 30, {
        now: () => now,
        createLeaseToken: () => 'lease_missing',
      }),
    ).resolves.toEqual({
      ok: false,
      reason: 'missing',
    })
  })
})
