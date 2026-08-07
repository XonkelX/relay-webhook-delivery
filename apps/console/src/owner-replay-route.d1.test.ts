import { env } from 'cloudflare:workers'
import { ReplayDeliveryAcceptedSchema } from '@relay/contracts'
import { describe, expect, it, vi } from 'vitest'
import app from '../worker/index.js'
import {
  createOwnerCsrfToken,
  createSignedOwnerSessionCookieValue,
} from '../worker/lib/owner-session-http.js'
import { createOwnerSession } from '../worker/lib/owner-session.js'

const signingKey = btoa('r'.repeat(32))
let sessionSequence = 0

async function ownerAuth() {
  sessionSequence += 1

  const rawToken = `rly_owner_${`replay${sessionSequence}`.padEnd(64, 'r').slice(0, 64)}`

  await createOwnerSession(env.DB, 3600, {
    createId: () => `ses_replay${sessionSequence}`,
    createToken: () => rawToken,
  })

  const signedCookie = await createSignedOwnerSessionCookieValue(rawToken, signingKey)

  const csrf = await createOwnerCsrfToken(rawToken, signingKey)

  return {
    cookie: `__Host-relay_owner=${signedCookie}; ` + `__Host-relay_csrf=${csrf}`,
    csrf,
  }
}

async function seedReplayFixture(
  suffix: string,
  options: {
    deliveryStatus?: 'queued' | 'retrying' | 'delivered' | 'exhausted' | 'cancelled'
    endpointStatus?: 'active' | 'paused' | 'disabled'
  } = {},
) {
  const now = new Date().toISOString()

  const apiKeyId = `key_replay${suffix}`
  const endpointId = `ep_replay${suffix}`
  const eventId = `evt_replay${suffix}`
  const deliveryId = `dlv_replay${suffix}`

  const deliveryStatus = options.deliveryStatus ?? 'delivered'

  const endpointStatus = options.endpointStatus ?? 'active'

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
      apiKeyId,
      `Replay ${suffix}`,
      `rly${suffix}`.padEnd(10, 'x'),
      suffix.padEnd(64, 'a').slice(0, 64),
      now,
    )
    .run()

  await env.DB.prepare(
    `INSERT INTO endpoints (
         id,
         name,
         url,
         status,
         created_at,
         updated_at,
         verified_at,
         disabled_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      endpointId,
      `Replay endpoint ${suffix}`,
      `https://${suffix}.example.test/webhook`,
      endpointStatus,
      now,
      now,
      endpointStatus === 'active' ? now : null,
      endpointStatus === 'disabled' ? now : null,
    )
    .run()

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
       VALUES (
         ?,
         ?,
         ?,
         'phase5.replay',
         '{}',
         ?,
         2,
         ?
       )`,
  )
    .bind(eventId, apiKeyId, `idem-${suffix}`, 'f'.repeat(64), now)
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
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
  )
    .bind(
      deliveryId,
      eventId,
      endpointId,
      deliveryStatus,
      now,
      now,
      now,
      deliveryStatus === 'delivered' ? now : null,
      deliveryStatus === 'exhausted' ? now : null,
    )
    .run()

  return {
    apiKeyId,
    endpointId,
    eventId,
    deliveryId,
  }
}

function requestReplay(
  deliveryId: string,
  auth: {
    cookie: string
    csrf: string
  },
  queueSend = vi.fn().mockResolvedValue(undefined),
) {
  return app.request(
    `/api/owner/deliveries/${deliveryId}/replay`,
    {
      method: 'POST',
      headers: {
        Cookie: auth.cookie,
        'X-Relay-CSRF': auth.csrf,
      },
    },
    {
      DB: env.DB,
      DELIVERY_QUEUE: {
        send: queueSend,
      },
      OWNER_SESSION_SIGNING_KEY: signingKey,
    },
  )
}

describe('POST /api/owner/deliveries/:deliveryId/replay', () => {
  it('creates and publishes a linked replay delivery atomically', async () => {
    const auth = await ownerAuth()
    const source = await seedReplayFixture('success')

    const queueSend = vi.fn().mockResolvedValue(undefined)

    const response = await requestReplay(source.deliveryId, auth, queueSend)

    expect(response.status).toBe(202)

    const body = ReplayDeliveryAcceptedSchema.parse(await response.json())

    expect(body).toMatchObject({
      replayOfDeliveryId: source.deliveryId,
      status: 'queued',
    })

    expect(body.deliveryId).not.toBe(source.deliveryId)

    expect(queueSend).toHaveBeenCalledTimes(1)
    expect(queueSend).toHaveBeenCalledWith(
      {
        version: 1,
        deliveryId: body.deliveryId,
        reason: 'replay',
      },
      {
        contentType: 'json',
      },
    )

    const replay = await env.DB.prepare(
      `SELECT
           event_id,
           endpoint_id,
           status,
           attempt_count,
           replay_of_delivery_id
         FROM deliveries
         WHERE id = ?`,
    )
      .bind(body.deliveryId)
      .first<{
        event_id: string
        endpoint_id: string
        status: string
        attempt_count: number
        replay_of_delivery_id: string | null
      }>()

    expect(replay).toEqual({
      event_id: source.eventId,
      endpoint_id: source.endpointId,
      status: 'queued',
      attempt_count: 0,
      replay_of_delivery_id: source.deliveryId,
    })

    const outbox = await env.DB.prepare(
      `SELECT
           reason,
           published_at,
           publish_attempts,
           last_error
         FROM delivery_outbox
         WHERE delivery_id = ?`,
    )
      .bind(body.deliveryId)
      .first<{
        reason: string
        published_at: string | null
        publish_attempts: number
        last_error: string | null
      }>()

    expect(outbox?.reason).toBe('replay')
    expect(outbox?.published_at).not.toBeNull()
    expect(outbox?.publish_attempts).toBe(1)
    expect(outbox?.last_error).toBeNull()

    const usageDate = body.createdAt.slice(0, 10)

    const perKeyUsage = await env.DB.prepare(
      `SELECT
           accepted_event_count,
           generated_delivery_count,
           payload_bytes
         FROM daily_usage
         WHERE api_key_id = ?
           AND usage_date = ?`,
    )
      .bind(source.apiKeyId, usageDate)
      .first<{
        accepted_event_count: number
        generated_delivery_count: number
        payload_bytes: number
      }>()

    expect(perKeyUsage).toEqual({
      accepted_event_count: 0,
      generated_delivery_count: 1,
      payload_bytes: 0,
    })

    const globalUsage = await env.DB.prepare(
      `SELECT
           accepted_event_count,
           generated_delivery_count,
           payload_bytes
         FROM global_daily_usage
         WHERE usage_date = ?`,
    )
      .bind(usageDate)
      .first<{
        accepted_event_count: number
        generated_delivery_count: number
        payload_bytes: number
      }>()

    expect(globalUsage).toEqual({
      accepted_event_count: 0,
      generated_delivery_count: 1,
      payload_bytes: 0,
    })

    const audit = await env.DB.prepare(
      `SELECT
           actor_type,
           action,
           target_type,
           target_id,
           metadata_json
         FROM audit_log
         WHERE action = 'delivery.replayed'
           AND target_id = ?
         LIMIT 1`,
    )
      .bind(body.deliveryId)
      .first<{
        actor_type: string
        action: string
        target_type: string
        target_id: string
        metadata_json: string
      }>()

    expect(audit).toMatchObject({
      actor_type: 'owner',
      action: 'delivery.replayed',
      target_type: 'delivery',
      target_id: body.deliveryId,
    })

    expect(JSON.parse(audit!.metadata_json)).toEqual({
      endpointId: source.endpointId,
      eventId: source.eventId,
      replayOfDeliveryId: source.deliveryId,
    })
  })

  it('keeps the replay durable when queue publication fails', async () => {
    const auth = await ownerAuth()
    const source = await seedReplayFixture('queuefail')

    const queueSend = vi.fn().mockRejectedValue(new Error('queue unavailable'))

    const response = await requestReplay(source.deliveryId, auth, queueSend)

    expect(response.status).toBe(202)

    const body = ReplayDeliveryAcceptedSchema.parse(await response.json())

    const outbox = await env.DB.prepare(
      `SELECT
           reason,
           published_at,
           publish_attempts,
           last_error
         FROM delivery_outbox
         WHERE delivery_id = ?`,
    )
      .bind(body.deliveryId)
      .first<{
        reason: string
        published_at: string | null
        publish_attempts: number
        last_error: string | null
      }>()

    expect(outbox).toEqual({
      reason: 'replay',
      published_at: null,
      publish_attempts: 1,
      last_error: 'queue unavailable',
    })
  })

  it('rejects replay of a nonterminal delivery', async () => {
    const auth = await ownerAuth()
    const source = await seedReplayFixture('nonterminal', {
      deliveryStatus: 'retrying',
    })

    const response = await requestReplay(source.deliveryId, auth)

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: {
        code: 'DELIVERY_NOT_REPLAYABLE',
        message: 'Only terminal deliveries can be replayed.',
      },
    })
  })

  it('rejects replay to an inactive endpoint', async () => {
    const auth = await ownerAuth()
    const source = await seedReplayFixture('inactive', {
      endpointStatus: 'paused',
    })

    const response = await requestReplay(source.deliveryId, auth)

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: {
        code: 'ENDPOINT_INACTIVE',
        message: 'The endpoint must be active before replaying a delivery.',
      },
    })
  })

  it('requires CSRF for replay mutations', async () => {
    const auth = await ownerAuth()
    const source = await seedReplayFixture('csrf')

    const response = await app.request(
      `/api/owner/deliveries/${source.deliveryId}/replay`,
      {
        method: 'POST',
        headers: {
          Cookie: auth.cookie,
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

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: {
        code: 'CSRF_REJECTED',
        message: 'A valid CSRF token is required.',
      },
    })
  })

  it('rejects malformed delivery identifiers', async () => {
    const auth = await ownerAuth()

    const response = await requestReplay('dlv_invalid_value', auth)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: {
        code: 'INVALID_DELIVERY_ID',
        message: 'The delivery identifier is invalid.',
      },
    })
  })

  it('returns 404 for an unknown valid delivery identifier', async () => {
    const auth = await ownerAuth()

    const response = await requestReplay('dlv_missing123', auth)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Delivery not found.',
      },
    })
  })
})
