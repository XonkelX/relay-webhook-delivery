import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { createEndpoint, replaceEndpointSubscriptions } from '../worker/lib/endpoint-persistence.js'

describe('D1 endpoint persistence', () => {
  it('persists pending endpoints and atomically replaces subscriptions', async () => {
    const endpoint = await createEndpoint(
      env.DB,
      {
        name: 'Orders',
        url: 'https://hooks.example.test/orders',
        eventTypes: ['order.created', 'order.cancelled', 'order.created'],
      },
      {
        now: () => '2026-08-05T12:15:00.000Z',
        createId: (prefix) => `${prefix}_endpoint_d1`,
      },
    )

    expect(endpoint.status).toBe('pending')

    const stored = await env.DB.prepare(
      `SELECT id, name, url, status
         FROM endpoints
         WHERE id = ?`,
    )
      .bind(endpoint.id)
      .first<{
        id: string
        name: string
        url: string
        status: string
      }>()

    expect(stored).toEqual({
      id: 'ep_endpoint_d1',
      name: 'Orders',
      url: 'https://hooks.example.test/orders',
      status: 'pending',
    })

    const initialSubscriptions = await env.DB.prepare(
      `SELECT event_type
         FROM endpoint_subscriptions
         WHERE endpoint_id = ?
         ORDER BY event_type`,
    )
      .bind(endpoint.id)
      .all<{ event_type: string }>()

    expect(initialSubscriptions.results).toEqual([
      { event_type: 'order.cancelled' },
      { event_type: 'order.created' },
    ])

    await replaceEndpointSubscriptions(env.DB, endpoint.id, ['order.fulfilled'], {
      now: () => '2026-08-05T12:20:00.000Z',
      createId: () => 'aud_subscription_d1',
    })

    const replacedSubscriptions = await env.DB.prepare(
      `SELECT event_type
         FROM endpoint_subscriptions
         WHERE endpoint_id = ?`,
    )
      .bind(endpoint.id)
      .all<{ event_type: string }>()

    expect(replacedSubscriptions.results).toEqual([{ event_type: 'order.fulfilled' }])

    const auditCount = await env.DB.prepare(
      `SELECT COUNT(*) AS count
         FROM audit_log
         WHERE target_id = ?`,
    )
      .bind(endpoint.id)
      .first<{ count: number }>()

    expect(auditCount?.count).toBe(2)
  })
})
