import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { createEndpoint } from '../worker/lib/endpoint-persistence.js'
import {
  resolveEndpointSigningSecrets,
  rotateEndpointSigningSecret,
} from '../worker/lib/endpoint-secret-store.js'
import { buildWebhookRequest } from '../worker/lib/webhook-request.js'
import { createWebhookSignature } from '../worker/lib/webhook-signing.js'

const previousSecret = `rly_whsec_${'a'.repeat(64)}`
const activeSecret = `rly_whsec_${'b'.repeat(64)}`

const keyring = {
  v1: btoa('k'.repeat(32)),
}

describe('endpoint secret rotation delivery signatures', () => {
  it('transitions from dual signatures to active-only after grace expiry', async () => {
    const endpoint = await createEndpoint(
      env.DB,
      {
        name: 'Dual signature endpoint',
        url: 'https://dual-signature.example.test/webhook',
        eventTypes: [],
      },
      {
        endpointSecretKeyVersion: 'v1',
        endpointSecretKeyring: keyring,
        createSigningSecret: () => previousSecret,
        createId: (prefix) => `${prefix}_dual_signature`,
      },
    )

    await rotateEndpointSigningSecret(env.DB, endpoint.id, 'v1', keyring, {
      nowMilliseconds: () => Date.parse('2026-08-07T02:00:00.000Z'),
      graceSeconds: 3600,
      createSecret: () => activeSecret,
    })

    const event = {
      id: 'evt_rotation_signature',
      type: 'order.created',
      timestamp: '2026-08-07T02:15:00.000Z',
      data: {
        orderId: 'ord_rotation',
      },
    } as const

    const timestampSeconds = 1786071600

    const graceSecrets = await resolveEndpointSigningSecrets(
      env.DB,
      endpoint.id,
      keyring,
      Date.parse('2026-08-07T02:30:00.000Z'),
    )

    expect(graceSecrets).toEqual([activeSecret, previousSecret])

    const duringGrace = await buildWebhookRequest({
      deliveryId: 'dlv_rotation_signature',
      endpointUrl: endpoint.url,
      event,
      signingSecrets: graceSecrets,
      timestampSeconds,
    })

    const activeSignature = await createWebhookSignature({
      messageId: duringGrace.webhookId,
      timestamp: timestampSeconds,
      rawBody: duringGrace.rawBody,
      secret: activeSecret,
    })

    const previousSignature = await createWebhookSignature({
      messageId: duringGrace.webhookId,
      timestamp: timestampSeconds,
      rawBody: duringGrace.rawBody,
      secret: previousSecret,
    })

    expect(duringGrace.request.headers.get('webhook-signature')).toBe(
      `${activeSignature} ${previousSignature}`,
    )

    const expiredSecrets = await resolveEndpointSigningSecrets(
      env.DB,
      endpoint.id,
      keyring,
      Date.parse('2026-08-07T03:00:01.000Z'),
    )

    expect(expiredSecrets).toEqual([activeSecret])

    const afterGrace = await buildWebhookRequest({
      deliveryId: 'dlv_rotation_signature',
      endpointUrl: endpoint.url,
      event,
      signingSecrets: expiredSecrets,
      timestampSeconds,
    })

    expect(afterGrace.request.headers.get('webhook-signature')).toBe(activeSignature)
  })
})
