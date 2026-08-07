import { env } from 'cloudflare:workers'
import { describe, expect, it, vi } from 'vitest'
import { claimDelivery } from '../worker/lib/delivery-claim.js'
import { processDeliveryMessage } from '../worker/lib/delivery-processor.js'

const createdAt = '2026-08-06T22:00:00.000Z'
const createdMs = Date.parse(createdAt)

async function seedDelivery(
  suffix: string,
  deliveryId: string,
  endpointUrl: string,
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO api_keys (
           id, name, key_prefix, secret_hash,
           status, created_at
         )
         VALUES (?, ?, ?, ?, 'active', ?)`,
    ).bind(
      `key_${suffix}`,
      `Key ${suffix}`,
      `rly_${suffix}_key`.slice(0, 24),
      suffix.padEnd(64, 'a').slice(0, 64),
      createdAt,
    ),

    env.DB.prepare(
      `INSERT INTO endpoints (
           id, name, url, status,
           created_at, updated_at, verified_at
         )
         VALUES (?, ?, ?, 'active', ?, ?, ?)`,
    ).bind(`ep_${suffix}`, `Endpoint ${suffix}`, endpointUrl, createdAt, createdAt, createdAt),

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
      `key_${suffix}`,
      `request-${suffix}`,
      'delivery.resilience',
      '{"value":"test"}',
      suffix.padEnd(64, 'b').slice(0, 64),
      16,
      createdAt,
    ),

    env.DB.prepare(
      `INSERT INTO deliveries (
           id, event_id, endpoint_id,
           status, attempt_count, next_attempt_at,
           created_at, updated_at
         )
         VALUES (?, ?, ?, 'queued', 0, ?, ?, ?)`,
    ).bind(deliveryId, `evt_${suffix}`, `ep_${suffix}`, createdAt, createdAt, createdAt),

    env.DB.prepare(
      `INSERT INTO delivery_outbox (
           id, delivery_id, available_at,
           published_at, publish_attempts,
           reason, created_at
         )
         VALUES (?, ?, ?, ?, 1, 'initial', ?)`,
    ).bind(`out_${suffix}`, deliveryId, createdAt, createdAt, createdAt),
  ])
}

function dependencies(fetcher: typeof fetch, suffix: string) {
  let lease = 0
  let attempt = 0

  return {
    resolveSigningSecrets: async () => ['test_secret'],
    fetcher,
    nowMilliseconds: () => createdMs,
    random: () => 0,
    createLeaseToken: () => `lease_${suffix}_${++lease}`,
    createAttemptId: () => `att_${suffix}_${++attempt}`,
  }
}

describe('D1 delivery resilience', () => {
  it('isolates a 429 endpoint from a successful endpoint and honors Retry-After', async () => {
    const retryDelivery = 'dlv_11111111111111111111111111111111'
    const successDelivery = 'dlv_22222222222222222222222222222222'

    await seedDelivery('rate', retryDelivery, 'https://example.test/rate')
    await seedDelivery('isolated', successDelivery, 'https://example.test/success')

    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input)

      if (url.endsWith('/rate')) {
        return new Response('slow down', {
          status: 429,
          headers: {
            'retry-after': '120',
          },
        })
      }

      return new Response(null, {
        status: 204,
      })
    }) as typeof fetch

    await expect(
      processDeliveryMessage(
        env.DB,
        {
          version: 1,
          deliveryId: retryDelivery,
          reason: 'initial',
        },
        dependencies(fetcher, 'rate'),
      ),
    ).resolves.toMatchObject({
      action: 'ack',
      outcome: 'transient_failure',
    })

    await expect(
      processDeliveryMessage(
        env.DB,
        {
          version: 1,
          deliveryId: successDelivery,
          reason: 'initial',
        },
        dependencies(fetcher, 'isolated'),
      ),
    ).resolves.toMatchObject({
      action: 'ack',
      outcome: 'success',
    })

    const states = await env.DB.prepare(
      `SELECT id, status, next_attempt_at
         FROM deliveries
         WHERE id IN (?, ?)
         ORDER BY id`,
    )
      .bind(retryDelivery, successDelivery)
      .all<{
        id: string
        status: string
        next_attempt_at: string
      }>()

    expect(states.results).toEqual([
      {
        id: retryDelivery,
        status: 'retrying',
        next_attempt_at: '2026-08-06T22:02:00.000Z',
      },
      {
        id: successDelivery,
        status: 'delivered',
        next_attempt_at: '2026-08-06T22:00:00.000Z',
      },
    ])
  })

  it('treats HTTP 400 as an immediate permanent failure', async () => {
    const deliveryId = 'dlv_33333333333333333333333333333333'

    await seedDelivery('bad', deliveryId, 'https://example.test/bad')

    const fetcher = vi.fn(
      async () =>
        new Response('bad request', {
          status: 400,
        }),
    ) as typeof fetch

    await expect(
      processDeliveryMessage(
        env.DB,
        {
          version: 1,
          deliveryId,
          reason: 'initial',
        },
        dependencies(fetcher, 'bad'),
      ),
    ).resolves.toMatchObject({
      action: 'ack',
      outcome: 'permanent_failure',
    })

    const delivery = await env.DB.prepare(
      `SELECT status, attempt_count, exhausted_at
         FROM deliveries
         WHERE id = ?`,
    )
      .bind(deliveryId)
      .first<{
        status: string
        attempt_count: number
        exhausted_at: string | null
      }>()

    expect(delivery).toEqual({
      status: 'exhausted',
      attempt_count: 1,
      exhausted_at: createdAt,
    })
  })

  it('persists timeout evidence and schedules a retry', async () => {
    const deliveryId = 'dlv_44444444444444444444444444444444'

    await seedDelivery('timeout', deliveryId, 'https://example.test/timeout')

    const fetcher = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              reject(new DOMException('aborted', 'AbortError'))
            },
            { once: true },
          )
        }),
    ) as typeof fetch

    await expect(
      processDeliveryMessage(
        env.DB,
        {
          version: 1,
          deliveryId,
          reason: 'initial',
        },
        {
          ...dependencies(fetcher, 'timeout'),
          timeoutMs: 5,
        },
      ),
    ).resolves.toMatchObject({
      action: 'ack',
      outcome: 'timeout',
    })

    const delivery = await env.DB.prepare(
      `SELECT status, attempt_count
         FROM deliveries
         WHERE id = ?`,
    )
      .bind(deliveryId)
      .first<{
        status: string
        attempt_count: number
      }>()

    expect(delivery).toEqual({
      status: 'retrying',
      attempt_count: 1,
    })

    const attempt = await env.DB.prepare(
      `SELECT outcome, error_class
         FROM delivery_attempts
         WHERE delivery_id = ?`,
    )
      .bind(deliveryId)
      .first<{
        outcome: string
        error_class: string | null
      }>()

    expect(attempt).toEqual({
      outcome: 'timeout',
      error_class: 'timeout',
    })
  })

  it('recovers a delivery after an expired lease', async () => {
    const deliveryId = 'dlv_55555555555555555555555555555555'

    await seedDelivery('lease', deliveryId, 'https://example.test/lease')

    await env.DB.prepare(
      `UPDATE deliveries
         SET status = 'leased',
             lease_token = ?,
             lease_expires_at = ?,
             updated_at = ?
         WHERE id = ?`,
    )
      .bind('lease_expired', '2026-08-06T21:59:00.000Z', '2026-08-06T21:58:30.000Z', deliveryId)
      .run()

    await expect(
      claimDelivery(env.DB, deliveryId, 30, {
        now: () => createdAt,
        createLeaseToken: () => 'lease_recovered',
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        id: deliveryId,
        attemptNo: 1,
        leaseToken: 'lease_recovered',
        leaseExpiresAt: '2026-08-06T22:00:30.000Z',
      },
    })
  })
})
