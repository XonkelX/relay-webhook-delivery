import { env } from 'cloudflare:workers'
import { EventDetailResponseSchema } from '@relay/contracts'
import { describe, expect, it, vi } from 'vitest'
import app from '../worker/index.js'
import { createSignedOwnerSessionCookieValue } from '../worker/lib/owner-session-http.js'
import { createOwnerSession } from '../worker/lib/owner-session.js'

const signingKey = btoa('i'.repeat(32))
let sessionSequence = 0

async function ownerCookie(suffix: string) {
  sessionSequence += 1

  const tokenBody = `${suffix}${sessionSequence}`
    .replace(/[^A-Za-z0-9]/gu, '')
    .padEnd(64, 'i')
    .slice(0, 64)

  const rawToken = `rly_owner_${tokenBody}`

  await createOwnerSession(env.DB, 3600, {
    createId: () => `ses_detail${sessionSequence}`,
    createToken: () => rawToken,
  })

  const signed = await createSignedOwnerSessionCookieValue(rawToken, signingKey)

  return `__Host-relay_owner=${signed}`
}

async function seedApiKey(suffix: string) {
  const id = `key_${suffix}`

  await env.DB.prepare(
    `INSERT INTO api_keys (
         id,
         name,
         key_prefix,
         secret_hash,
         status,
         created_at
       )
       VALUES (?, ?, ?, ?, 'active', ?)`,
  )
    .bind(
      id,
      `Detail ${suffix}`,
      `rly${suffix}`.padEnd(10, 'x'),
      suffix.padEnd(64, 'f').slice(0, 64),
      '2026-08-07T04:00:00.000Z',
    )
    .run()

  return id
}

async function seedEndpoint(suffix: string, name: string) {
  const id = `ep_${suffix}`

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
       VALUES (?, ?, ?, 'active', ?, ?, ?)`,
  )
    .bind(
      id,
      name,
      `https://${suffix}.example.test/webhook`,
      '2026-08-07T04:00:00.000Z',
      '2026-08-07T04:00:00.000Z',
      '2026-08-07T04:00:00.000Z',
    )
    .run()

  return id
}

async function seedEvent(apiKeyId: string, suffix: string) {
  const id = `evt_${suffix}`

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
       VALUES (?, ?, ?, 'phase5.detail', '{}', ?, 2, ?)`,
  )
    .bind(id, apiKeyId, `idem-${suffix}`, 'a'.repeat(64), '2026-08-07T05:00:00.000Z')
    .run()

  return id
}

async function seedDelivery(input: {
  id: string
  eventId: string
  endpointId: string
  status: 'delivered' | 'retrying'
  attemptCount: number
  createdAt: string
}) {
  const completedAt = input.status === 'delivered' ? input.createdAt : null

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
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  )
    .bind(
      input.id,
      input.eventId,
      input.endpointId,
      input.status,
      input.attemptCount,
      input.createdAt,
      input.createdAt,
      input.createdAt,
      completedAt,
    )
    .run()
}

async function seedCompletedAttempt(input: {
  id: string
  deliveryId: string
  number: number
  webhookId: string | null
  outcome: 'success' | 'transient_failure'
  startedAt: string
  completedAt: string
  statusCode: number
  latencyMs: number
  errorClass: string | null
  responseExcerpt: string
}) {
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
         error_class,
         response_excerpt,
         created_at,
         lease_token,
         webhook_id
       )
       VALUES (
         ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       )`,
  )
    .bind(
      input.id,
      input.deliveryId,
      input.number,
      input.outcome,
      input.startedAt,
      input.completedAt,
      input.statusCode,
      input.latencyMs,
      input.errorClass,
      input.responseExcerpt,
      input.startedAt,
      `lease_${input.id}`,
      input.webhookId,
    )
    .run()
}

function requestDetail(eventId: string, cookie: string) {
  return app.request(
    `/api/owner/events/${eventId}`,
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
}

describe('GET /api/owner/events/:eventId', () => {
  it('returns fan-out deliveries and ordered attempt evidence', async () => {
    const cookie = await ownerCookie('fanout')
    const apiKey = await seedApiKey('detailfanout')
    const eventId = await seedEvent(apiKey, 'detailfanout')

    const endpointA = await seedEndpoint('detaila', 'Accounting')
    const endpointB = await seedEndpoint('detailb', 'CRM')

    await seedDelivery({
      id: 'dlv_detaila',
      eventId,
      endpointId: endpointA,
      status: 'delivered',
      attemptCount: 1,
      createdAt: '2026-08-07T05:01:00.000Z',
    })

    await seedDelivery({
      id: 'dlv_detailb',
      eventId,
      endpointId: endpointB,
      status: 'retrying',
      attemptCount: 2,
      createdAt: '2026-08-07T05:02:00.000Z',
    })

    await seedCompletedAttempt({
      id: 'att_detaila1',
      deliveryId: 'dlv_detaila',
      number: 1,
      webhookId: 'msg_detaila',
      outcome: 'success',
      startedAt: '2026-08-07T05:01:01.000Z',
      completedAt: '2026-08-07T05:01:01.125Z',
      statusCode: 200,
      latencyMs: 125,
      errorClass: null,
      responseExcerpt: 'ok',
    })

    await seedCompletedAttempt({
      id: 'att_detailb1',
      deliveryId: 'dlv_detailb',
      number: 1,
      webhookId: 'msg_detailb',
      outcome: 'transient_failure',
      startedAt: '2026-08-07T05:02:01.000Z',
      completedAt: '2026-08-07T05:02:01.210Z',
      statusCode: 503,
      latencyMs: 210,
      errorClass: 'http_503',
      responseExcerpt: 'try later',
    })

    await seedCompletedAttempt({
      id: 'att_detailb2',
      deliveryId: 'dlv_detailb',
      number: 2,
      webhookId: null,
      outcome: 'transient_failure',
      startedAt: '2026-08-07T05:03:01.000Z',
      completedAt: '2026-08-07T05:03:01.190Z',
      statusCode: 503,
      latencyMs: 190,
      errorClass: 'http_503',
      responseExcerpt: 'still unavailable',
    })

    const response = await requestDetail(eventId, cookie)

    expect(response.status).toBe(200)

    const body = EventDetailResponseSchema.parse(await response.json())

    expect(body.event).toMatchObject({
      id: eventId,
      status: 'mixed',
      deliveries: {
        delivered: 1,
        retrying: 1,
        total: 2,
      },
    })

    expect(body.deliveries.map((delivery) => delivery.id)).toEqual(['dlv_detaila', 'dlv_detailb'])

    expect(body.deliveries[0]).toMatchObject({
      endpoint: {
        id: endpointA,
        name: 'Accounting',
        status: 'active',
      },
      status: 'delivered',
      attempts: [
        {
          id: 'att_detaila1',
          webhookId: 'msg_detaila',
          number: 1,
          outcome: 'success',
          statusCode: 200,
          latencyMs: 125,
        },
      ],
    })

    expect(body.deliveries[1]?.attempts.map((attempt) => attempt.number)).toEqual([1, 2])

    expect(body.deliveries[1]?.attempts[1]).toMatchObject({
      webhookId: null,
      outcome: 'transient_failure',
      errorClass: 'http_503',
      responseExcerpt: 'still unavailable',
    })
  })

  it('represents accepted events with no deliveries', async () => {
    const cookie = await ownerCookie('empty')
    const apiKey = await seedApiKey('detailempty')
    const eventId = await seedEvent(apiKey, 'detailempty')

    const response = await requestDetail(eventId, cookie)

    expect(response.status).toBe(200)

    const body = EventDetailResponseSchema.parse(await response.json())

    expect(body.event.status).toBe('no_deliveries')
    expect(body.event.deliveries.total).toBe(0)
    expect(body.deliveries).toEqual([])
  })

  it('rejects malformed event identifiers', async () => {
    const cookie = await ownerCookie('invalid')

    const response = await requestDetail('evt_invalid_value', cookie)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: {
        code: 'INVALID_EVENT_ID',
        message: 'The event identifier is invalid.',
      },
    })
  })

  it('returns 404 for an unknown valid event identifier', async () => {
    const cookie = await ownerCookie('missing')

    const response = await requestDetail('evt_missing123', cookie)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Event not found.',
      },
    })
  })
})
