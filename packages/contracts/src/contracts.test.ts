import { describe, expect, it } from 'vitest'
import {
  DeliveryQueueMessageSchema,
  EventIdSchema,
  EventTypeSchema,
  IdempotencyKeySchema,
  IngestEventAcceptedSchema,
  IngestEventRequestSchema,
} from './index'

describe('identifier contracts', () => {
  it('accepts the canonical event prefix', () => {
    expect(EventIdSchema.parse('evt_01J4M8Y7Z5V8W7R2XK1A9C3P0Q')).toBe(
      'evt_01J4M8Y7Z5V8W7R2XK1A9C3P0Q',
    )
  })

  it('rejects a delivery identifier using the old prefix', () => {
    expect(() =>
      DeliveryQueueMessageSchema.parse({
        version: 1,
        deliveryId: 'del_01J4M8Z2M6A1S7H4N8T0K5F9CD',
        reason: 'initial',
      }),
    ).toThrow()
  })
})

describe('event ingestion contracts', () => {
  it('accepts a strict JSON event request', () => {
    expect(
      IngestEventRequestSchema.parse({
        type: 'invoice.payment_failed',
        data: {
          invoiceId: 'inv_123',
          retryable: true,
          amount: 4200,
        },
      }),
    ).toEqual({
      type: 'invoice.payment_failed',
      data: {
        invoiceId: 'inv_123',
        retryable: true,
        amount: 4200,
      },
    })
  })

  it('rejects unknown top-level fields', () => {
    expect(() =>
      IngestEventRequestSchema.parse({
        type: 'order.completed',
        data: {},
        unexpected: true,
      }),
    ).toThrow()
  })

  it.each(['Invoice.PaymentFailed', '.invoice.created', 'invoice created', 'invoice..created'])(
    'rejects invalid event type %s',
    (eventType) => {
      expect(EventTypeSchema.safeParse(eventType).success).toBe(false)
    },
  )

  it('trims valid idempotency keys', () => {
    expect(IdempotencyKeySchema.parse('  request-123  ')).toBe('request-123')
  })

  it('validates accepted responses', () => {
    expect(
      IngestEventAcceptedSchema.parse({
        eventId: 'evt_01J4M8Y7Z5V8W7R2XK1A9C3P0Q',
        status: 'accepted',
        duplicate: false,
        deliveryCount: 2,
        createdAt: '2026-08-05T07:45:00.000Z',
      }),
    ).toMatchObject({
      status: 'accepted',
      deliveryCount: 2,
    })
  })
})
