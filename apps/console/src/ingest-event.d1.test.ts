import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { ingestEvent } from '../worker/lib/ingest-event.js'

const createdAt = '2026-08-05T09:30:00.000Z'
const apiKeyId = 'key_integration'

describe('D1 event ingestion', () => {
  it('persists fanout atomically and enforces idempotency', async () => {
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
      ).bind(apiKeyId, 'Integration key', 'rly_test_12345678', 'a'.repeat(64), createdAt),

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
      ).bind('ep_alpha', 'Alpha', 'https://example.test/alpha', createdAt, createdAt, createdAt),

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
      ).bind('ep_beta', 'Beta', 'https://example.test/beta', createdAt, createdAt, createdAt),

      env.DB.prepare(
        `INSERT INTO endpoints (
             id,
             name,
             url,
             status,
             created_at,
             updated_at
           )
           VALUES (?, ?, ?, 'paused', ?, ?)`,
      ).bind('ep_paused', 'Paused', 'https://example.test/paused', createdAt, createdAt),

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
      ).bind(
        'ep_other',
        'Other event',
        'https://example.test/other',
        createdAt,
        createdAt,
        createdAt,
      ),

      env.DB.prepare(
        `INSERT INTO endpoint_subscriptions (
             endpoint_id,
             event_type,
             created_at
           )
           VALUES (?, ?, ?)`,
      ).bind('ep_alpha', 'invoice.created', createdAt),

      env.DB.prepare(
        `INSERT INTO endpoint_subscriptions (
             endpoint_id,
             event_type,
             created_at
           )
           VALUES (?, ?, ?)`,
      ).bind('ep_beta', 'invoice.created', createdAt),

      env.DB.prepare(
        `INSERT INTO endpoint_subscriptions (
             endpoint_id,
             event_type,
             created_at
           )
           VALUES (?, ?, ?)`,
      ).bind('ep_paused', 'invoice.created', createdAt),

      env.DB.prepare(
        `INSERT INTO endpoint_subscriptions (
             endpoint_id,
             event_type,
             created_at
           )
           VALUES (?, ?, ?)`,
      ).bind('ep_other', 'customer.created', createdAt),
    ])

    const request = {
      idempotencyKey: 'integration-request',
      event: {
        type: 'invoice.created',
        data: {
          z: 2,
          a: 1,
        },
      },
      payloadBytes: 72,
      payloadJson: '{"type":"invoice.created","data":{"z":2,"a":1}}',
    } as const

    let sequence = 0

    const accepted = await ingestEvent(env.DB, apiKeyId, request, {
      now: () => createdAt,
      createId: (prefix) => `${prefix}_integration_${++sequence}`,
    })

    expect(accepted).toEqual({
      ok: true,
      value: {
        eventId: 'evt_integration_1',
        duplicate: false,
        deliveryCount: 2,
        createdAt,
      },
    })

    const event = await env.DB.prepare(
      `SELECT
           id,
           event_type,
           payload_json,
           payload_bytes
         FROM events
         WHERE id = ?`,
    )
      .bind('evt_integration_1')
      .first<{
        id: string
        event_type: string
        payload_json: string
        payload_bytes: number
      }>()

    expect(event).toEqual({
      id: 'evt_integration_1',
      event_type: 'invoice.created',
      payload_json: '{"a":1,"z":2}',
      payload_bytes: 72,
    })

    const deliveries = await env.DB.prepare(
      `SELECT endpoint_id, status, attempt_count
         FROM deliveries
         WHERE event_id = ?
         ORDER BY endpoint_id`,
    )
      .bind('evt_integration_1')
      .all<{
        endpoint_id: string
        status: string
        attempt_count: number
      }>()

    expect(deliveries.results).toEqual([
      {
        endpoint_id: 'ep_alpha',
        status: 'queued',
        attempt_count: 0,
      },
      {
        endpoint_id: 'ep_beta',
        status: 'queued',
        attempt_count: 0,
      },
    ])

    const outbox = await env.DB.prepare(
      `SELECT COUNT(*) AS count
         FROM delivery_outbox
         WHERE published_at IS NULL`,
    ).first<{ count: number }>()

    expect(outbox?.count).toBe(2)

    const usage = await env.DB.prepare(
      `SELECT
           accepted_event_count,
           generated_delivery_count,
           payload_bytes
         FROM daily_usage
         WHERE api_key_id = ?
           AND usage_date = ?`,
    )
      .bind(apiKeyId, '2026-08-05')
      .first<{
        accepted_event_count: number
        generated_delivery_count: number
        payload_bytes: number
      }>()

    expect(usage).toEqual({
      accepted_event_count: 1,
      generated_delivery_count: 2,
      payload_bytes: 72,
    })

    const audit = await env.DB.prepare(
      `SELECT action, target_id
         FROM audit_log
         WHERE target_id = ?`,
    )
      .bind('evt_integration_1')
      .first<{
        action: string
        target_id: string
      }>()

    expect(audit).toEqual({
      action: 'event.accepted',
      target_id: 'evt_integration_1',
    })

    const duplicate = await ingestEvent(env.DB, apiKeyId, request, {
      createId: () => {
        throw new Error('Duplicate requests must not create IDs')
      },
    })

    expect(duplicate).toEqual({
      ok: true,
      value: {
        eventId: 'evt_integration_1',
        duplicate: true,
        deliveryCount: 2,
        createdAt,
      },
    })

    const conflict = await ingestEvent(
      env.DB,
      apiKeyId,
      {
        ...request,
        event: {
          ...request.event,
          data: {
            a: 999,
          },
        },
      },
      {
        createId: () => {
          throw new Error('Conflicts must not create IDs')
        },
      },
    )

    expect(conflict).toEqual({
      ok: false,
      reason: 'idempotency_conflict',
    })

    let rollbackOutboxSequence = 0

    await expect(
      ingestEvent(
        env.DB,
        apiKeyId,
        {
          ...request,
          idempotencyKey: 'rollback-request',
        },
        {
          now: () => createdAt,
          createId: (prefix) => {
            if (prefix === 'evt') {
              return 'evt_rollback'
            }

            if (prefix === 'dlv') {
              return 'dlv_forced_duplicate'
            }

            if (prefix === 'out') {
              rollbackOutboxSequence += 1
              return `out_rollback_${rollbackOutboxSequence}`
            }

            return 'aud_rollback'
          },
        },
      ),
    ).rejects.toThrow()

    const finalCounts = await env.DB.prepare(
      `SELECT
           (SELECT COUNT(*) FROM events) AS events,
           (SELECT COUNT(*) FROM deliveries) AS deliveries,
           (SELECT COUNT(*) FROM delivery_outbox) AS outbox,
           (SELECT COUNT(*) FROM audit_log) AS audits`,
    ).first<{
      events: number
      deliveries: number
      outbox: number
      audits: number
    }>()

    expect(finalCounts).toEqual({
      events: 1,
      deliveries: 2,
      outbox: 2,
      audits: 1,
    })

    const finalUsage = await env.DB.prepare(
      `SELECT accepted_event_count, generated_delivery_count
         FROM daily_usage
         WHERE api_key_id = ?
           AND usage_date = ?`,
    )
      .bind(apiKeyId, '2026-08-05')
      .first<{
        accepted_event_count: number
        generated_delivery_count: number
      }>()

    expect(finalUsage).toEqual({
      accepted_event_count: 1,
      generated_delivery_count: 2,
    })
  })
})
