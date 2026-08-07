import { describe, expect, it } from 'vitest'
import {
  buildWebhookRequest,
  createWebhookId,
  serializeWebhookBody,
} from '../worker/lib/webhook-request.js'
import { createSignedContent, createWebhookSignature } from '../worker/lib/webhook-signing.js'

const rawBody = '{"type":"order.created","data":{"order_id":"ord_1042"}}'

describe('webhook signing', () => {
  it('constructs the exact signed content', () => {
    expect(
      createSignedContent({
        messageId: 'msg_01JTEST',
        timestamp: 1785834000,
        rawBody,
        secret: 'test_secret_123',
      }),
    ).toBe(`msg_01JTEST.1785834000.${rawBody}`)
  })

  it('matches a deterministic HMAC-SHA256 vector', async () => {
    await expect(
      createWebhookSignature({
        messageId: 'msg_01JTEST',
        timestamp: 1785834000,
        rawBody,
        secret: 'test_secret_123',
      }),
    ).resolves.toBe('v1,RnXJVQbLK4Qt4ta1oX6v9yyBnSob1b4s6IgjGZIWCQw=')
  })

  it('rejects invalid signing inputs', async () => {
    await expect(
      createWebhookSignature({
        messageId: '',
        timestamp: 1,
        rawBody: '{}',
        secret: 'secret',
      }),
    ).rejects.toThrow('Webhook message ID is required.')

    await expect(
      createWebhookSignature({
        messageId: 'msg_test',
        timestamp: -1,
        rawBody: '{}',
        secret: 'secret',
      }),
    ).rejects.toThrow('Webhook timestamp must be a non-negative integer.')
  })
})

describe('webhook request construction', () => {
  it('creates a stable webhook ID from the delivery ID', () => {
    expect(createWebhookId('dlv_01JTEST')).toBe('msg_01JTEST')
  })

  it('serializes once and signs the unchanged request body', async () => {
    const event = {
      id: 'evt_01JTEST',
      type: 'order.created',
      timestamp: '2026-08-04T09:00:00.000Z',
      data: {
        order_id: 'ord_1042',
        total: 4999,
      },
    } as const

    const expectedBody =
      '{"id":"evt_01JTEST","type":"order.created","timestamp":"2026-08-04T09:00:00.000Z","data":{"order_id":"ord_1042","total":4999}}'

    expect(serializeWebhookBody(event)).toBe(expectedBody)

    const built = await buildWebhookRequest({
      deliveryId: 'dlv_01JTEST',
      endpointUrl: 'https://example.test/webhooks',
      event,
      signingSecrets: ['endpoint_secret'],
      timestampSeconds: 1785834000,
    })

    expect(built.webhookId).toBe('msg_01JTEST')
    expect(built.rawBody).toBe(expectedBody)
    expect(await built.request.text()).toBe(expectedBody)
    expect(built.request.redirect).toBe('manual')
    expect(built.request.headers.get('webhook-id')).toBe('msg_01JTEST')
    expect(built.request.headers.get('webhook-timestamp')).toBe('1785834000')
    expect(built.request.headers.get('webhook-signature')).toMatch(/^v1,[A-Za-z0-9+/]+=*$/)
    expect(built.request.headers.get('user-agent')).toBe('Relay-Webhooks/1.0')
  })
})
