import type { AttemptOutcome, DeliveryStatus, JsonValue } from '@relay/contracts'
import { sanitizeResponseHeaders } from './response-headers.js'

const REDACTED_VALUE = '[REDACTED]'

const SENSITIVE_PAYLOAD_KEYS = new Set([
  'accesstoken',
  'apikey',
  'authorization',
  'clientsecret',
  'cookie',
  'password',
  'passwd',
  'privatekey',
  'refreshtoken',
  'secret',
  'setcookie',
  'signature',
  'signingsecret',
  'token',
])

function normalizeSensitiveKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function isSensitivePayloadKey(value: string): boolean {
  const normalized = normalizeSensitiveKey(value)

  return (
    SENSITIVE_PAYLOAD_KEYS.has(normalized) ||
    normalized.endsWith('password') ||
    normalized.endsWith('secret') ||
    normalized.endsWith('token') ||
    normalized.endsWith('apikey') ||
    normalized.endsWith('privatekey')
  )
}

export function sanitizePayloadForInspector(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(sanitizePayloadForInspector)
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        isSensitivePayloadKey(key) ? REDACTED_VALUE : sanitizePayloadForInspector(child),
      ]),
    )
  }

  return value
}

export function buildSafeRequestHeaders(
  webhookId: string | null,
  requestStartedAt: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': 'Relay-Webhooks/1.0',
    'webhook-signature': REDACTED_VALUE,
  }

  if (webhookId) {
    headers['webhook-id'] = webhookId
  }

  const timestamp = Date.parse(requestStartedAt)

  if (Number.isFinite(timestamp)) {
    headers['webhook-timestamp'] = String(Math.floor(timestamp / 1000))
  }

  return headers
}

export function parseSafeResponseHeaders(serialized: string | null): Record<string, string> {
  if (!serialized) {
    return {}
  }

  try {
    const parsed = JSON.parse(serialized) as unknown

    if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
      return {}
    }

    const headers: Record<string, string> = {}

    for (const [name, value] of Object.entries(parsed)) {
      if (typeof value === 'string') {
        headers[name] = value
      }
    }

    return sanitizeResponseHeaders(headers)
  } catch {
    return {}
  }
}

interface LatestAttemptEvidence {
  outcome: AttemptOutcome | null
  statusCode: number | null
  completedAt: string | null
  errorClass: string | null
}

interface RetryExplanationInput {
  status: DeliveryStatus
  attemptCount: number
  nextAttemptAt: string
  replayOfDeliveryId: string | null
  lastErrorClass: string | null
  latestAttempt: LatestAttemptEvidence | null
}

function retrySchedule(completedAt: string | null, nextAttemptAt: string): string {
  const completed = completedAt ? Date.parse(completedAt) : Number.NaN

  const next = Date.parse(nextAttemptAt)

  if (!Number.isFinite(completed) || !Number.isFinite(next) || next <= completed) {
    return `at ${nextAttemptAt}`
  }

  const milliseconds = next - completed

  if (milliseconds < 60_000) {
    const seconds = Math.max(1, Math.ceil(milliseconds / 1000))

    return `in ${seconds} second${seconds === 1 ? '' : 's'}`
  }

  if (milliseconds < 3_600_000) {
    const minutes = Math.max(1, Math.ceil(milliseconds / 60_000))

    return `in ${minutes} minute${minutes === 1 ? '' : 's'}`
  }

  const hours = Math.max(1, Math.ceil(milliseconds / 3_600_000))

  return `in ${hours} hour${hours === 1 ? '' : 's'}`
}

export function explainDeliveryRetry(input: RetryExplanationInput): string {
  const latest = input.latestAttempt
  const nextAttempt = input.attemptCount + 1

  if (input.status === 'queued') {
    return input.replayOfDeliveryId
      ? 'Replay is queued for its first attempt.'
      : 'Delivery is queued for its first attempt.'
  }

  if (input.status === 'leased') {
    return `Attempt ${nextAttempt} is currently in progress.`
  }

  if (input.status === 'retrying') {
    const schedule = retrySchedule(latest?.completedAt ?? null, input.nextAttemptAt)

    if (latest?.statusCode !== null && latest?.statusCode !== undefined) {
      return `HTTP ${latest.statusCode} is transient. Attempt ${nextAttempt} is scheduled ${schedule}.`
    }

    if (latest?.outcome === 'timeout') {
      return `The receiver timed out. Attempt ${nextAttempt} is scheduled ${schedule}.`
    }

    if (latest?.outcome === 'network_error') {
      return `The receiver could not be reached. Attempt ${nextAttempt} is scheduled ${schedule}.`
    }

    return `The previous attempt failed transiently. Attempt ${nextAttempt} is scheduled ${schedule}.`
  }

  if (input.status === 'delivered') {
    return latest?.statusCode
      ? `HTTP ${latest.statusCode} succeeded. Delivery is complete; no retry is scheduled.`
      : 'Delivery succeeded. No retry is scheduled.'
  }

  if (input.status === 'exhausted') {
    if (latest?.outcome === 'permanent_failure' && latest.statusCode !== null) {
      return `HTTP ${latest.statusCode} is permanent. No automatic retry is scheduled.`
    }

    if (latest?.statusCode !== null && latest?.statusCode !== undefined) {
      return `HTTP ${latest.statusCode} remained retryable, but the maximum attempt count was reached. No automatic retry is scheduled.`
    }

    return 'The delivery exhausted its retry budget. No automatic retry is scheduled.'
  }

  if (input.lastErrorClass === 'endpoint_url_changed') {
    return 'Delivery was cancelled because the endpoint URL changed. Re-verification is required before new delivery.'
  }

  if (input.lastErrorClass === 'endpoint_inactive') {
    return 'Delivery was cancelled because the endpoint is inactive. No retry is scheduled.'
  }

  return 'Delivery was cancelled. No retry is scheduled.'
}
