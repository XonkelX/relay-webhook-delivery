import { sanitizeResponseHeaders } from './response-headers.js'

const DEFAULT_TIMEOUT_MS = 10_000
const MAX_TIMEOUT_MS = 60_000
const MAX_RESPONSE_BYTES = 8_192
const MAX_EXCERPT_CHARS = 2_000

export interface ExecuteWebhookInput {
  request: Request
  timeoutMs?: number
}

export interface ExecuteWebhookDependencies {
  fetcher?: typeof fetch
  nowMilliseconds?: () => number
}

export type WebhookExecutionResult =
  | {
      kind: 'response'
      statusCode: number
      latencyMs: number
      responseHeaders: Record<string, string>
      responseExcerpt: string
      retryAfter: string | null
    }
  | {
      kind: 'timeout'
      latencyMs: number
      errorClass: 'timeout'
    }
  | {
      kind: 'network_error'
      latencyMs: number
      errorClass: string
    }

function validateTimeout(timeoutMs: number): void {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new TypeError('Webhook timeout must be an integer between 1 and 60000 milliseconds.')
  }
}

function latency(startedAt: number, completedAt: number): number {
  return Math.max(0, Math.round(completedAt - startedAt))
}

async function readExcerpt(response: Response): Promise<string> {
  if (!response.body) {
    return ''
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytesRead = 0
  let excerpt = ''

  try {
    while (bytesRead < MAX_RESPONSE_BYTES) {
      const chunk = await reader.read()

      if (chunk.done) {
        break
      }

      const remaining = MAX_RESPONSE_BYTES - bytesRead
      const value =
        chunk.value.byteLength > remaining ? chunk.value.slice(0, remaining) : chunk.value

      excerpt += decoder.decode(value, { stream: true })
      bytesRead += value.byteLength

      if (chunk.value.byteLength > remaining) {
        await reader.cancel()
        break
      }
    }

    excerpt += decoder.decode()
  } finally {
    reader.releaseLock()
  }

  return excerpt.slice(0, MAX_EXCERPT_CHARS)
}

export async function executeWebhook(
  input: ExecuteWebhookInput,
  dependencies: ExecuteWebhookDependencies = {},
): Promise<WebhookExecutionResult> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
  validateTimeout(timeoutMs)

  const fetcher = dependencies.fetcher ?? fetch
  const nowMilliseconds = dependencies.nowMilliseconds ?? Date.now
  const controller = new AbortController()
  const startedAt = nowMilliseconds()
  let timedOut = false

  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    const response = await fetcher(input.request, {
      signal: controller.signal,
    })

    return {
      kind: 'response',
      statusCode: response.status,
      latencyMs: latency(startedAt, nowMilliseconds()),
      responseHeaders: sanitizeResponseHeaders(response.headers),
      responseExcerpt: await readExcerpt(response),
      retryAfter: response.headers.get('retry-after'),
    }
  } catch (error) {
    const elapsed = latency(startedAt, nowMilliseconds())

    if (timedOut) {
      return {
        kind: 'timeout',
        latencyMs: elapsed,
        errorClass: 'timeout',
      }
    }

    return {
      kind: 'network_error',
      latencyMs: elapsed,
      errorClass:
        error instanceof Error && error.name ? error.name.slice(0, 120) : 'UnknownNetworkError',
    }
  } finally {
    clearTimeout(timer)
  }
}
