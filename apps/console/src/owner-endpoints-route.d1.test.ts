import { env } from 'cloudflare:workers'
import { EndpointListResponseSchema } from '@relay/contracts'
import { describe, expect, it, vi } from 'vitest'
import app from '../worker/index.js'
import { createSignedOwnerSessionCookieValue } from '../worker/lib/owner-session-http.js'
import { createOwnerSession } from '../worker/lib/owner-session.js'

const signingKey = btoa('p'.repeat(32))
let sessionSequence = 0

async function ownerCookie() {
  sessionSequence += 1

  const rawToken = `rly_owner_${`endpoints${sessionSequence}`.padEnd(64, 'p').slice(0, 64)}`

  await createOwnerSession(env.DB, 3600, {
    createId: () => `ses_endpoints${sessionSequence}`,
    createToken: () => rawToken,
  })

  const signed = await createSignedOwnerSessionCookieValue(rawToken, signingKey)

  return `__Host-relay_owner=${signed}`
}

async function seedSecret(
  endpointId: string,
  generation: number,
  state: 'active' | 'previous',
  validUntil: string | null,
) {
  await env.DB.prepare(
    `INSERT INTO endpoint_signing_secrets (
         endpoint_id,
         generation,
         state,
         key_version,
         iv_base64,
         ciphertext_base64,
         valid_until,
         created_at
       )
       VALUES (?, ?, ?, 'v1', ?, ?, ?, ?)`,
  )
    .bind(
      endpointId,
      generation,
      state,
      'a'.repeat(16),
      'b'.repeat(32),
      validUntil,
      new Date().toISOString(),
    )
    .run()
}

describe('GET /api/owner/endpoints', () => {
  it('returns real endpoint health and operational metadata without secret material', async () => {
    const cookie = await ownerCookie()

    const now = Date.now()
    const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString()
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString()
    const oneHourFromNow = new Date(now + 60 * 60 * 1000).toISOString()

    await env.DB.prepare(
      `INSERT INTO api_keys (
           id,
           name,
           key_prefix,
           secret_hash,
           status,
           created_at
         )
         VALUES (
           'key_endpointmetrics',
           'Endpoint metrics',
           'rly_endpoint1',
           ?,
           'active',
           ?
         )`,
    )
      .bind('endpointmetrics'.padEnd(64, '9'), twoHoursAgo)
      .run()

    await env.DB.prepare(
      `INSERT INTO endpoints (
           id,
           name,
           url,
           status,
           created_at,
           updated_at,
           verified_at
         )
         VALUES
           (
             'ep_endpointsactive',
             'Billing',
             'https://billing.example.test/webhook',
             'active',
             ?,
             ?,
             ?
           ),
           (
             'ep_endpointspaused',
             'Paused endpoint',
             'https://paused.example.test/webhook',
             'paused',
             ?,
             ?,
             ?
           )`,
    )
      .bind(twoHoursAgo, oneHourAgo, twoHoursAgo, twoHoursAgo, oneHourAgo, twoHoursAgo)
      .run()

    await env.DB.prepare(
      `INSERT INTO endpoint_subscriptions (
           endpoint_id,
           event_type,
           created_at
         )
         VALUES
           (
             'ep_endpointsactive',
             'invoice.failed',
             ?
           ),
           (
             'ep_endpointsactive',
             'invoice.paid',
             ?
           )`,
    )
      .bind(twoHoursAgo, twoHoursAgo)
      .run()

    await seedSecret('ep_endpointsactive', 1, 'previous', oneHourFromNow)
    await seedSecret('ep_endpointsactive', 2, 'active', null)
    await seedSecret('ep_endpointspaused', 1, 'active', null)

    await env.DB.prepare(
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
         VALUES
           (
             'evt_endpointsuccess',
             'key_endpointmetrics',
             'endpoint-success',
             'invoice.paid',
             '{}',
             ?,
             2,
             ?
           ),
           (
             'evt_endpointfailure',
             'key_endpointmetrics',
             'endpoint-failure',
             'invoice.failed',
             '{}',
             ?,
             2,
             ?
           )`,
    )
      .bind('c'.repeat(64), twoHoursAgo, 'd'.repeat(64), oneHourAgo)
      .run()

    await env.DB.prepare(
      `INSERT INTO deliveries (
           id,
           event_id,
           endpoint_id,
           status,
           attempt_count,
           next_attempt_at,
           created_at,
           updated_at,
           delivered_at,
           exhausted_at
         )
         VALUES
           (
             'dlv_endpointsuccess',
             'evt_endpointsuccess',
             'ep_endpointsactive',
             'delivered',
             1,
             ?,
             ?,
             ?,
             ?,
             NULL
           ),
           (
             'dlv_endpointfailure',
             'evt_endpointfailure',
             'ep_endpointsactive',
             'exhausted',
             1,
             ?,
             ?,
             ?,
             NULL,
             ?
           )`,
    )
      .bind(
        twoHoursAgo,
        twoHoursAgo,
        twoHoursAgo,
        twoHoursAgo,
        oneHourAgo,
        oneHourAgo,
        oneHourAgo,
        oneHourAgo,
      )
      .run()

    await env.DB.prepare(
      `INSERT INTO delivery_attempts (
           id,
           delivery_id,
           attempt_no,
           state,
           outcome,
           request_started_at,
           completed_at,
           status_code,
           latency_ms,
           created_at
         )
         VALUES
           (
             'att_endpointsuccess',
             'dlv_endpointsuccess',
             1,
             'completed',
             'success',
             ?,
             ?,
             200,
             100,
             ?
           ),
           (
             'att_endpointfailure',
             'dlv_endpointfailure',
             1,
             'completed',
             'permanent_failure',
             ?,
             ?,
             400,
             200,
             ?
           )`,
    )
      .bind(twoHoursAgo, twoHoursAgo, twoHoursAgo, oneHourAgo, oneHourAgo, oneHourAgo)
      .run()

    const response = await app.request(
      '/api/owner/endpoints',
      {
        headers: {
          Cookie: cookie,
        },
      },
      {
        DB: env.DB,
        DELIVERY_QUEUE: {
          send: vi.fn().mockResolvedValue(undefined),
        },
        OWNER_SESSION_SIGNING_KEY: signingKey,
      },
    )

    expect(response.status).toBe(200)

    const body = EndpointListResponseSchema.parse(await response.json())

    const active = body.items.find((endpoint) => endpoint.id === 'ep_endpointsactive')

    expect(active).toMatchObject({
      name: 'Billing',
      status: 'active',
      health: 'degraded',
      subscriptions: ['invoice.failed', 'invoice.paid'],
      successRate24h: 50,
      averageLatencyMs24h: 150,
      eventCount24h: 2,
      secretGeneration: 2,
      previousSecretValidUntil: oneHourFromNow,
    })

    expect(active?.lastDeliveryAt).toBe(oneHourAgo)

    const paused = body.items.find((endpoint) => endpoint.id === 'ep_endpointspaused')

    expect(paused).toMatchObject({
      status: 'paused',
      health: 'unknown',
      subscriptions: [],
      successRate24h: null,
      averageLatencyMs24h: null,
      eventCount24h: 0,
      lastDeliveryAt: null,
      secretGeneration: 1,
      previousSecretValidUntil: null,
    })

    const serialized = JSON.stringify(body)

    expect(serialized).not.toContain('signingSecret')
    expect(serialized).not.toContain('ciphertext')
    expect(serialized).not.toContain('ivBase64')
    expect(serialized).not.toContain('keyVersion')
  })
})
