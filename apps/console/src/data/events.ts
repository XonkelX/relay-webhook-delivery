import type { AttemptFixture, EventFixture } from './types'

function attempt(
  id: string,
  number: number,
  occurredAt: string,
  latencyMs: number,
  statusCode: number | null,
  outcome: AttemptFixture['outcome'],
  errorClass?: string,
): AttemptFixture {
  return {
    id,
    number,
    occurredAt,
    latencyMs,
    statusCode,
    outcome,
    errorClass,
  }
}

export const eventFixtures: EventFixture[] = [
  {
    id: 'evt_01J4M8Y7Z5V8W7R2XK1A9C3P0Q',
    deliveryId: 'dlv_01J4M8Z2M6A1S7H4N8T0K5F9CD',
    webhookId: 'wh_01J4M7R8Q2D6N3V9B5X1A0K4TS',
    eventType: 'order.completed',
    endpointName: 'Production Orders',
    endpointUrl: 'https://api.example.com/webhooks/orders',
    createdAt: '2026-08-04T19:42:11.000Z',
    status: 'delivered',
    attemptCount: 1,
    attempts: [
      attempt('att_01J4M901D7H5F2Q8S3N6W0C4BA', 1, '2026-08-04T19:42:12.000Z', 184, 204, 'success'),
    ],
  },
  {
    id: 'evt_01J4M91QX3F7D8A2S6N5K0V4BC',
    deliveryId: 'dlv_01J4M92JH8T1C6P3R5V9N0A7QD',
    webhookId: 'wh_01J4M7R8Q2D6N3V9B5X1A0K4TS',
    eventType: 'invoice.payment_failed',
    endpointName: 'Billing Platform',
    endpointUrl: 'https://billing.example.com/hooks/relay',
    createdAt: '2026-08-04T19:37:08.000Z',
    status: 'retrying',
    attemptCount: 2,
    nextRetryAt: '2026-08-04T20:07:08.000Z',
    attempts: [
      attempt(
        'att_01J4M932C1N8K6V4Q7A0D5S9PX',
        1,
        '2026-08-04T19:37:09.000Z',
        10000,
        null,
        'timeout',
        'RequestTimeout',
      ),
      attempt(
        'att_01J4M93M5F2D8S6A1N7V0K4QRC',
        2,
        '2026-08-04T19:42:09.000Z',
        431,
        503,
        'transient_failure',
        'UpstreamUnavailable',
      ),
    ],
  },
  {
    id: 'evt_01J4M94V7D2K9A5S1N8F0Q6XCP',
    deliveryId: 'dlv_01J4M95C3R8V1N6T0A4K7D2QFS',
    webhookId: 'wh_01J4M7T9A4C2P8N6D1V5Q0S3XR',
    eventType: 'customer.deleted',
    endpointName: 'Legacy CRM',
    endpointUrl: 'https://crm.example.net/webhook',
    createdAt: '2026-08-04T18:15:44.000Z',
    status: 'exhausted',
    attemptCount: 4,
    attempts: [
      attempt('att_01', 1, '2026-08-04T18:15:45.000Z', 92, 500, 'transient_failure'),
      attempt('att_02', 2, '2026-08-04T18:20:45.000Z', 108, 500, 'transient_failure'),
      attempt('att_03', 3, '2026-08-04T18:35:45.000Z', 97, 500, 'transient_failure'),
      attempt('att_04', 4, '2026-08-04T19:05:45.000Z', 104, 500, 'permanent_failure'),
    ],
  },
  {
    id: 'evt_01J4M96N4A7D2S8F5K1V0Q9XRC',
    deliveryId: 'dlv_01J4M97B6N3T8C1A5D0Q4V2KFS',
    webhookId: 'wh_01J4M7T9A4C2P8N6D1V5Q0S3XR',
    eventType: 'customer.deleted',
    endpointName: 'Legacy CRM',
    endpointUrl: 'https://crm.example.net/webhook',
    createdAt: '2026-08-04T19:26:03.000Z',
    status: 'replayed',
    attemptCount: 1,
    replayOf: 'evt_01J4M94V7D2K9A5S1N8F0Q6XCP',
    attempts: [
      attempt('att_01J4M98H5C2Q7N1V4D9A0S6KRT', 1, '2026-08-04T19:26:04.000Z', 221, 200, 'success'),
    ],
  },
]
