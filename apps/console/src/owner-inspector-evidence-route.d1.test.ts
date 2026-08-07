import { env } from 'cloudflare:workers'
import { EventDetailResponseSchema } from '@relay/contracts'
import { describe, expect, it, vi } from 'vitest'
import app from '../worker/index.js'
import { createSignedOwnerSessionCookieValue } from '../worker/lib/owner-session-http.js'
import { createOwnerSession } from '../worker/lib/owner-session.js'

const signingKey = btoa('v'.repeat(32))

async function ownerCookie() {
  const rawToken = `rly_owner_${'inspector'.padEnd(64, 'v')}`

  await createOwnerSession(env.DB, 3600, {
    createId: () => 'ses_inspectorevidence',
    createToken: () => rawToken,
  })

  const signed = await createSignedOwnerSessionCookieValue(rawToken, signingKey)

  return `__Host-relay_owner=${signed}`
}

describe('owner inspector evidence', () => {
  it('returns redacted payload/header evidence, retry explanation, and bidirectional replay lineage', async () => {
    const cookie = await ownerCookie()

    const payloadJson = JSON.stringify({
      customer: 'cus_visible',
      authorization: 'Bearer payload-secret',
      nested: {
        apiKey: 'api-secret',
        ordinary: 42,
      },
    })

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO api_keys (
           id, name, key_prefix, secret_hash,
           status, created_at
         )
         VALUES (?, ?, ?, ?, 'active', ?)`,
      ).bind(
        'key_inspectorevidence',
        'Inspector evidence',
        'rlyinspect',
        'a'.repeat(64),
        '2026-08-07T05:00:00.000Z',
      ),

      env.DB.prepare(
        `INSERT INTO endpoints (
           id, name, url, status,
           created_at, updated_at, verified_at
         )
         VALUES (?, ?, ?, 'active', ?, ?, ?)`,
      ).bind(
        'ep_inspectorevidence',
        'Inspector receiver',
        'https://inspector.example.test/webhook',
        '2026-08-07T05:00:00.000Z',
        '2026-08-07T05:00:00.000Z',
        '2026-08-07T05:00:00.000Z',
      ),

      env.DB.prepare(
        `INSERT INTO endpoints (
           id, name, url, status,
           created_at, updated_at, verified_at
         )
         VALUES (?, ?, ?, 'active', ?, ?, ?)`,
      ).bind(
        'ep_inspectorretry',
        'Inspector retry receiver',
        'https://inspector-retry.example.test/webhook',
        '2026-08-07T05:00:00.000Z',
        '2026-08-07T05:00:00.000Z',
        '2026-08-07T05:00:00.000Z',
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
        'evt_inspectorevidence',
        'key_inspectorevidence',
        'inspector-evidence',
        'invoice.payment_failed',
        payloadJson,
        'b'.repeat(64),
        new TextEncoder().encode(payloadJson).byteLength,
        '2026-08-07T05:00:00.000Z',
      ),

      env.DB.prepare(
        `INSERT INTO deliveries (
           id, event_id, endpoint_id, status,
           attempt_count, next_attempt_at,
           created_at, updated_at, delivered_at
         )
         VALUES (?, ?, ?, 'delivered', 1, ?, ?, ?, ?)`,
      ).bind(
        'dlv_inspectorsource',
        'evt_inspectorevidence',
        'ep_inspectorevidence',
        '2026-08-07T05:01:00.000Z',
        '2026-08-07T05:01:00.000Z',
        '2026-08-07T05:01:01.000Z',
        '2026-08-07T05:01:01.000Z',
      ),

      env.DB.prepare(
        `INSERT INTO deliveries (
           id, event_id, endpoint_id, status,
           attempt_count, next_attempt_at,
           replay_of_delivery_id,
           created_at, updated_at
         )
         VALUES (?, ?, ?, 'queued', 0, ?, ?, ?, ?)`,
      ).bind(
        'dlv_inspectorreplay',
        'evt_inspectorevidence',
        'ep_inspectorevidence',
        '2026-08-07T05:04:00.000Z',
        'dlv_inspectorsource',
        '2026-08-07T05:04:00.000Z',
        '2026-08-07T05:04:00.000Z',
      ),

      env.DB.prepare(
        `INSERT INTO deliveries (
           id, event_id, endpoint_id, status,
           attempt_count, next_attempt_at,
           last_error_class,
           created_at, updated_at
         )
         VALUES (?, ?, ?, 'retrying', 1, ?, 'http_503', ?, ?)`,
      ).bind(
        'dlv_inspectorretry',
        'evt_inspectorevidence',
        'ep_inspectorretry',
        '2026-08-07T05:10:00.000Z',
        '2026-08-07T05:02:00.000Z',
        '2026-08-07T05:03:00.000Z',
      ),

      env.DB.prepare(
        `INSERT INTO delivery_attempts (
           id, delivery_id, attempt_no,
           state, outcome,
           request_started_at, completed_at,
           status_code, latency_ms,
           response_excerpt, created_at,
           webhook_id
         )
         VALUES (?, ?, 1, 'completed', 'success', ?, ?, 200, 120, ?, ?, ?)`,
      ).bind(
        'att_inspectorsource',
        'dlv_inspectorsource',
        '2026-08-07T05:01:00.000Z',
        '2026-08-07T05:01:01.000Z',
        'ok',
        '2026-08-07T05:01:00.000Z',
        'msg_inspectorsource',
      ),

      env.DB.prepare(
        `INSERT INTO delivery_attempts (
           id, delivery_id, attempt_no,
           state, outcome,
           request_started_at, completed_at,
           status_code, latency_ms,
           error_class, response_headers_json,
           response_excerpt, created_at,
           webhook_id
         )
         VALUES (
           ?, ?, 1, 'completed', 'transient_failure',
           ?, ?, 503, 180, 'http_503', ?, ?, ?, ?
         )`,
      ).bind(
        'att_inspectorretry',
        'dlv_inspectorretry',
        '2026-08-07T05:02:59.820Z',
        '2026-08-07T05:03:00.000Z',
        JSON.stringify({
          authorization: 'Bearer database-secret',
          'set-cookie': 'session=database-secret',
          'x-request-id': 'req_inspector',
          'x-untrusted-header': 'drop-me',
        }),
        'temporarily unavailable',
        '2026-08-07T05:02:59.820Z',
        'msg_inspectorretry',
      ),
    ])

    const response = await app.request(
      '/api/owner/events/evt_inspectorevidence',
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

    const body = EventDetailResponseSchema.parse(await response.json())

    expect(body.safePayload).toEqual({
      customer: 'cus_visible',
      authorization: '[REDACTED]',
      nested: {
        apiKey: '[REDACTED]',
        ordinary: 42,
      },
    })

    const source = body.deliveries.find((delivery) => delivery.id === 'dlv_inspectorsource')

    const replay = body.deliveries.find((delivery) => delivery.id === 'dlv_inspectorreplay')

    const retry = body.deliveries.find((delivery) => delivery.id === 'dlv_inspectorretry')

    expect(source?.replayedByDeliveryIds).toEqual(['dlv_inspectorreplay'])

    expect(replay?.replayOfDeliveryId).toBe('dlv_inspectorsource')

    expect(retry?.retryExplanation).toBe(
      'HTTP 503 is transient. Attempt 2 is scheduled in 7 minutes.',
    )

    expect(retry?.attempts[0]?.requestHeaders).toMatchObject({
      'webhook-id': 'msg_inspectorretry',
      'webhook-signature': '[REDACTED]',
    })

    expect(retry?.attempts[0]?.responseHeaders).toEqual({
      authorization: '[REDACTED]',
      'set-cookie': '[REDACTED]',
      'x-request-id': 'req_inspector',
    })

    const serialized = JSON.stringify(body)

    expect(serialized).not.toContain('payload-secret')
    expect(serialized).not.toContain('api-secret')
    expect(serialized).not.toContain('database-secret')
    expect(serialized).not.toContain('drop-me')
  })
})
