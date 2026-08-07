const MAX_HEADER_VALUE_CHARS = 500
const REDACTED_VALUE = '[REDACTED]'

const SAFE_RESPONSE_HEADER_NAMES = new Set([
  'cf-ray',
  'content-type',
  'retry-after',
  'traceparent',
  'x-correlation-id',
  'x-relay-challenge',
  'x-request-id',
])

const SENSITIVE_RESPONSE_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'set-cookie',
  'set-cookie2',
  'www-authenticate',
  'x-access-token',
  'x-api-key',
  'x-auth-token',
  'x-relay-signature',
])

function isSensitiveHeaderName(name: string): boolean {
  return (
    SENSITIVE_RESPONSE_HEADER_NAMES.has(name) ||
    name.includes('authorization') ||
    name.includes('cookie') ||
    name.endsWith('-token') ||
    name.endsWith('-secret') ||
    name.endsWith('-key')
  )
}

export function sanitizeResponseHeaders(
  headers: Headers | Readonly<Record<string, string>>,
): Record<string, string> {
  const sanitized: Record<string, string> = {}

  function capture(rawName: string, rawValue: string) {
    const name = rawName.trim().toLowerCase()

    if (isSensitiveHeaderName(name)) {
      sanitized[name] = REDACTED_VALUE
      return
    }

    if (!SAFE_RESPONSE_HEADER_NAMES.has(name)) {
      return
    }

    sanitized[name] = rawValue.slice(0, MAX_HEADER_VALUE_CHARS)
  }

  if (headers instanceof Headers) {
    headers.forEach((value, name) => capture(name, value))
  } else {
    for (const [name, value] of Object.entries(headers)) {
      capture(name, value)
    }
  }

  return sanitized
}
