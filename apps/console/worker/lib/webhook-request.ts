import type { JsonValue } from '@relay/contracts'
import { createWebhookHeadersForSecrets } from './webhook-signing.js'

export interface OutboundWebhookEvent {
  id: string
  type: string
  timestamp: string
  data: JsonValue
}

export interface BuildWebhookRequestInput {
  deliveryId: string
  endpointUrl: string
  event: OutboundWebhookEvent
  signingSecrets: readonly string[]
  timestampSeconds: number
}

export interface BuiltWebhookRequest {
  webhookId: string
  rawBody: string
  request: Request
}

export function createWebhookId(deliveryId: string): string {
  if (!deliveryId.startsWith('dlv_')) {
    throw new TypeError('Webhook delivery ID must use the dlv_ prefix.')
  }

  return `msg_${deliveryId.slice(4)}`
}

export function serializeWebhookBody(event: OutboundWebhookEvent): string {
  return JSON.stringify({
    id: event.id,
    type: event.type,
    timestamp: event.timestamp,
    data: event.data,
  })
}

export async function buildWebhookRequest(
  input: BuildWebhookRequestInput,
): Promise<BuiltWebhookRequest> {
  const webhookId = createWebhookId(input.deliveryId)
  const rawBody = serializeWebhookBody(input.event)

  const headers = await createWebhookHeadersForSecrets({
    messageId: webhookId,
    timestamp: input.timestampSeconds,
    rawBody,
    secrets: input.signingSecrets,
  })

  return {
    webhookId,
    rawBody,
    request: new Request(input.endpointUrl, {
      method: 'POST',
      headers,
      body: rawBody,
      redirect: 'manual',
    }),
  }
}
