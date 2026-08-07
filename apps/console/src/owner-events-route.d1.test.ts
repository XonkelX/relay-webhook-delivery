import { env } from 'cloudflare:workers'
import { EventListResponseSchema } from '@relay/contracts'
import { describe, expect, it, vi } from 'vitest'
import app from '../worker/index.js'
import { createSignedOwnerSessionCookieValue } from '../worker/lib/owner-session-http.js'
import { createOwnerSession } from '../worker/lib/owner-session.js'

const signingKey = btoa('e'.repeat(32))

let ownerSessionSequence = 0

async function ownerCookie(suffix: string) {
  ownerSessionSequence += 1
  const uniqueSuffix = `${suffix}${ownerSessionSequence}`
  const rawToken = `rly_owner_${uniqueSuffix.padEnd(64, 'a').slice(0, 64)}`

  await createOwnerSession(env.DB, 3600, {
    createId: () => `ses_events_${uniqueSuffix}`,
    createToken: () => rawToken,
  })

  const signed = await createSignedOwnerSessionCookieValue(rawToken, signingKey)

  return `__Host-relay_owner=${signed}`
}

async function seedApiKey(suffix: string) {
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
      `key_events_${suffix}`,
      `Events ${suffix}`,
      `rly_${suffix}`.padEnd(12, 'x'),
      suffix.padEnd(64, 'f').slice(0, 64),
      '2026-08-07T04:00:00.000Z',
    )
    .run()

  return `key_events_${suffix}`
}

async function seedEndpoint(suffix: string) {
  const id = `ep_events_${suffix}`

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
      `Endpoint ${suffix}`,
      `https://${suffix}.example.test/webhook`,
      '2026-08-07T04:00:00.000Z',
      '2026-08-07T04:00:00.000Z',
      '2026-08-07T04:00:00.000Z',
    )
    .run()

  return id
}

async function seedEvent(apiKeyId: string, suffix: string, eventType: string, createdAt: string) {
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
       VALUES (?, ?, ?, ?, '{}', ?, 2, ?)`,
  )
    .bind(id, apiKeyId, `idem-${suffix}`, eventType, 'a'.repeat(64), createdAt)
    .run()

  return id
}

async function seedDelivery(
  eventId: string,
  endpointId: string,
  suffix: string,
  status: 'queued' | 'retrying' | 'delivered' | 'exhausted',
) {
  const timestamp = '2026-08-07T05:00:00.000Z'

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
       VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
  )
    .bind(
      `dlv_${suffix}`,
      eventId,
      endpointId,
      status,
      timestamp,
      timestamp,
      timestamp,
      status === 'delivered' ? timestamp : null,
      status === 'exhausted' ? timestamp : null,
    )
    .run()
}

function requestEvents(cookie: string, query = '') {
  return app.request(
    `/api/owner/events${query}`,
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

describe('GET /api/owner/events', () => {
  it('uses deterministic cursor pagination', async () => {
    const cookie = await ownerCookie('cursor')
    const apiKey = await seedApiKey('cursor')

    await seedEvent(apiKey, 'cursora', 'phase5.cursor', '2026-08-07T05:03:00.000Z')
    await seedEvent(apiKey, 'cursorb', 'phase5.cursor', '2026-08-07T05:02:00.000Z')
    await seedEvent(apiKey, 'cursorc', 'phase5.cursor', '2026-08-07T05:01:00.000Z')

    const first = await requestEvents(cookie, '?eventType=phase5.cursor&limit=2')

    expect(first.status).toBe(200)

    const firstBody = EventListResponseSchema.parse(await first.json())

    expect(firstBody.items.map((item) => item.id)).toEqual(['evt_cursora', 'evt_cursorb'])

    expect(firstBody.items.every((item) => item.status === 'no_deliveries')).toBe(true)

    expect(firstBody.nextCursor).not.toBeNull()

    const second = await requestEvents(
      cookie,
      `?eventType=phase5.cursor&limit=2&cursor=${encodeURIComponent(firstBody.nextCursor!)}`,
    )

    const secondBody = EventListResponseSchema.parse(await second.json())

    expect(secondBody.items.map((item) => item.id)).toEqual(['evt_cursorc'])
    expect(secondBody.nextCursor).toBeNull()
  })

  it('filters by delivery status while retaining aggregate counts', async () => {
    const cookie = await ownerCookie('filter')
    const apiKey = await seedApiKey('filter')
    const endpoint = await seedEndpoint('filter')

    const retryingEvent = await seedEvent(
      apiKey,
      'filterretry',
      'phase5.filter',
      '2026-08-07T05:10:00.000Z',
    )

    const deliveredEvent = await seedEvent(
      apiKey,
      'filterdelivered',
      'phase5.filter',
      '2026-08-07T05:09:00.000Z',
    )

    await seedDelivery(retryingEvent, endpoint, 'filterretry', 'retrying')
    await seedDelivery(deliveredEvent, endpoint, 'filterdelivered', 'delivered')

    const response = await requestEvents(cookie, '?eventType=phase5.filter&status=retrying')

    const body = EventListResponseSchema.parse(await response.json())

    expect(body.items.map((item) => item.id)).toEqual(['evt_filterretry'])

    expect(body.items[0]).toMatchObject({
      status: 'retrying',
      deliveries: {
        retrying: 1,
        total: 1,
      },
    })
  })

  it.each([
    '?limit=0',
    '?limit=101',
    '?limit=abc',
    '?status=replayed',
    '?eventType=INVALID TYPE',
    '?cursor=***',
  ])('rejects invalid query %s', async (query) => {
    const cookie = await ownerCookie(`invalid${query.length}`)

    const response = await requestEvents(cookie, query)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: {
        code: 'INVALID_QUERY',
        message: 'The event query parameters are invalid.',
      },
    })
  })
})
