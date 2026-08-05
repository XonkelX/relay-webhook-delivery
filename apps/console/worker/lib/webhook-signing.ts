export interface WebhookSignatureInput {
  messageId: string
  timestamp: number
  rawBody: string
  secret: string
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary)
}

function validateSignatureInput(input: WebhookSignatureInput): void {
  if (!input.messageId.trim()) {
    throw new TypeError('Webhook message ID is required.')
  }

  if (!Number.isInteger(input.timestamp) || input.timestamp < 0) {
    throw new TypeError('Webhook timestamp must be a non-negative integer.')
  }

  if (!input.secret) {
    throw new TypeError('Webhook signing secret is required.')
  }
}

export function createSignedContent(input: WebhookSignatureInput): string {
  validateSignatureInput(input)

  return `${input.messageId}.${input.timestamp}.${input.rawBody}`
}

export async function createWebhookSignature(input: WebhookSignatureInput): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(input.secret),
    {
      name: 'HMAC',
      hash: 'SHA-256',
    },
    false,
    ['sign'],
  )

  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(createSignedContent(input)),
  )

  return `v1,${bytesToBase64(new Uint8Array(signature))}`
}

export async function createWebhookHeaders(input: WebhookSignatureInput): Promise<Headers> {
  const headers = new Headers()

  headers.set('content-type', 'application/json')
  headers.set('user-agent', 'Relay-Webhooks/1.0')
  headers.set('webhook-id', input.messageId)
  headers.set('webhook-timestamp', String(input.timestamp))
  headers.set('webhook-signature', await createWebhookSignature(input))

  return headers
}
