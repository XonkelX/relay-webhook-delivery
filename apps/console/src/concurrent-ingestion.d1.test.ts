import { env } from 'cloudflare:workers'
import { describe, expect, it, vi } from 'vitest'
import worker from '../worker/index.js'
import { sha256Hex } from '../worker/lib/auth.js'

interface IngestionResponse {
  eventId: string
  status: 'accepted'
  duplicate: boolean
  deliveryCount: number
  createdAt: string
}

describe('concurrent HTTP event ingestion', () => {
  it('creates one event and one delivery for concurrent identical requests', async () => {
    const rawKey = `rly_live_${'e'.repeat(64)}`
    const createdAt = '2026-08-05T20:30:00.000Z'

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
      ).bind(
        'key_concurrent',
        'Concurrent test',
        rawKey.slice(0, 16),
        await sha256Hex(rawKey),
        createdAt,
      ),

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
        'ep_concurrent',
        'Concurrent endpoint',
        'https://example.test/concurrent',
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
      ).bind('ep_concurrent', 'invoice.concurrent', createdAt),
    ])

    const send = vi.fn(async () => undefined)
    const body = JSON.stringify({
      type: 'invoice.concurrent',
      data: {
        invoiceId: 'inv_concurrent',
      },
    })

    const sendRequest = () =>
      worker.request(
        '/v1/events',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${rawKey}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': 'concurrent-request',
          },
          body,
        },
        {
          DB: env.DB,
          DELIVERY_QUEUE: {
            send,
          },
        },
      )

    const responses = await Promise.all([sendRequest(), sendRequest()])

    expect(responses.map((response) => response.status)).toEqual([202, 202])

    const results = (await Promise.all(
      responses.map((response) => response.json()),
    )) as IngestionResponse[]

    expect(new Set(results.map((result) => result.eventId)).size).toBe(1)
    expect(results.filter((result) => result.duplicate)).toHaveLength(1)
    expect(results.filter((result) => !result.duplicate)).toHaveLength(1)

    expect(
      results.every((result) => result.status === 'accepted' && result.deliveryCount === 1),
    ).toBe(true)

    const counts = await env.DB.prepare(
      `SELECT
           (SELECT COUNT(*)
            FROM events
            WHERE api_key_id = ?) AS events,

           (SELECT COUNT(*)
            FROM deliveries
            WHERE event_id = (
              SELECT id
              FROM events
              WHERE api_key_id = ?
                AND idempotency_key = ?
            )) AS deliveries,

           (SELECT COUNT(*)
            FROM delivery_outbox
            WHERE delivery_id IN (
              SELECT id
              FROM deliveries
              WHERE event_id = (
                SELECT id
                FROM events
                WHERE api_key_id = ?
                  AND idempotency_key = ?
              )
            )) AS outbox,

           (SELECT COUNT(*)
            FROM audit_log
            WHERE action = 'event.accepted'
              AND target_id = (
                SELECT id
                FROM events
                WHERE api_key_id = ?
                  AND idempotency_key = ?
              )) AS audits`,
    )
      .bind(
        'key_concurrent',
        'key_concurrent',
        'concurrent-request',
        'key_concurrent',
        'concurrent-request',
        'key_concurrent',
        'concurrent-request',
      )
      .first<{
        events: number
        deliveries: number
        outbox: number
        audits: number
      }>()

    expect(counts).toEqual({
      events: 1,
      deliveries: 1,
      outbox: 1,
      audits: 1,
    })

    const usage = await env.DB.prepare(
      `SELECT
           accepted_event_count,
           generated_delivery_count
         FROM daily_usage
         WHERE api_key_id = ?`,
    )
      .bind('key_concurrent')
      .first<{
        accepted_event_count: number
        generated_delivery_count: number
      }>()

    expect(usage).toEqual({
      accepted_event_count: 1,
      generated_delivery_count: 1,
    })

    expect(send.mock.calls.length).toBeGreaterThanOrEqual(1)
  })
})
