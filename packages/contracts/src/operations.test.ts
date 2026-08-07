import { describe, expect, it } from 'vitest'
import {
  EndpointSummarySchema,
  EventListResponseSchema,
  ReplayDeliveryAcceptedSchema,
} from './index'

describe('operational console contracts', () => {
  it('represents an event with multiple delivery states', () => {
    const parsed = EventListResponseSchema.parse({
      items: [
        {
          id: 'evt_console1',
          eventType: 'order.completed',
          createdAt: '2026-08-07T05:00:00.000Z',
          payloadBytes: 128,
          status: 'mixed',
          deliveries: {
            queued: 0,
            leased: 0,
            retrying: 1,
            delivered: 1,
            exhausted: 0,
            cancelled: 0,
            total: 2,
          },
        },
      ],
      nextCursor: 'opaque-cursor',
      metrics: {
        events24h: 1,
        deliveredDeliveries24h: 1,
        retryingDeliveriesNow: 1,
        exhaustedDeliveries24h: 0,
        successRate24h: 50,
      },
    })

    expect(parsed.items[0]?.status).toBe('mixed')
    expect(parsed.items[0]?.deliveries.total).toBe(2)
  })

  it('rejects inconsistent delivery totals', () => {
    expect(() =>
      EventListResponseSchema.parse({
        items: [
          {
            id: 'evt_console2',
            eventType: 'invoice.paid',
            createdAt: '2026-08-07T05:00:00.000Z',
            payloadBytes: 64,
            status: 'delivered',
            deliveries: {
              queued: 0,
              leased: 0,
              retrying: 0,
              delivered: 1,
              exhausted: 0,
              cancelled: 0,
              total: 2,
            },
          },
        ],
        nextCursor: null,
        metrics: {
          events24h: 1,
          deliveredDeliveries24h: 1,
          retryingDeliveriesNow: 0,
          exhaustedDeliveries24h: 0,
          successRate24h: 100,
        },
      }),
    ).toThrow()
  })

  it('keeps persisted endpoint status separate from health', () => {
    const endpoint = EndpointSummarySchema.parse({
      id: 'ep_console1',
      name: 'Billing',
      url: 'https://hooks.example.com/billing',
      status: 'pending',
      health: 'unknown',
      verifiedAt: null,
      updatedAt: '2026-08-07T05:00:00.000Z',
      subscriptions: ['invoice.paid'],
      successRate24h: null,
      averageLatencyMs24h: null,
      eventCount24h: 0,
      lastDeliveryAt: null,
      secretGeneration: 1,
      previousSecretValidUntil: null,
    })

    expect(endpoint.status).toBe('pending')
    expect(endpoint.health).toBe('unknown')
  })

  it('models replay as a delivery relationship, not a status', () => {
    expect(
      ReplayDeliveryAcceptedSchema.parse({
        deliveryId: 'dlv_replay2',
        replayOfDeliveryId: 'dlv_original1',
        status: 'queued',
        createdAt: '2026-08-07T05:00:00.000Z',
      }),
    ).toMatchObject({
      status: 'queued',
      replayOfDeliveryId: 'dlv_original1',
    })
  })
})
