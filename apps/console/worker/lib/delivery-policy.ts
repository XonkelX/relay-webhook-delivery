import type { AttemptOutcome } from '@relay/contracts'

const DEFAULT_BASE_DELAY_SECONDS = 5
const DEFAULT_MAX_DELAY_SECONDS = 60 * 60
const MAX_RETRY_AFTER_SECONDS = 24 * 60 * 60

export type HttpAttemptOutcome = Extract<
  AttemptOutcome,
  'success' | 'transient_failure' | 'permanent_failure'
>

export interface RetryDecision {
  outcome: HttpAttemptOutcome
  retryable: boolean
  delaySeconds: number | null
}

export interface RetryPolicyOptions {
  retryAfter?: string | null
  nowMilliseconds?: number
  random?: () => number
  baseDelaySeconds?: number
  maxDelaySeconds?: number
}

export function classifyHttpStatus(statusCode: number): HttpAttemptOutcome {
  if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
    throw new TypeError('HTTP status code must be an integer between 100 and 599.')
  }

  if (statusCode >= 200 && statusCode <= 299) {
    return 'success'
  }

  if (
    statusCode === 408 ||
    statusCode === 409 ||
    statusCode === 425 ||
    statusCode === 429 ||
    statusCode >= 500
  ) {
    return 'transient_failure'
  }

  return 'permanent_failure'
}

export function parseRetryAfter(value: string | null, nowMilliseconds = Date.now()): number | null {
  const normalized = value?.trim()

  if (!normalized) {
    return null
  }

  if (/^\d+$/.test(normalized)) {
    const seconds = Number(normalized)

    if (!Number.isSafeInteger(seconds)) {
      return null
    }

    return Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(1, seconds))
  }

  const retryAt = Date.parse(normalized)

  if (!Number.isFinite(retryAt)) {
    return null
  }

  const seconds = Math.ceil((retryAt - nowMilliseconds) / 1000)

  return Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(1, seconds))
}

export function calculateBackoffDelay(
  attemptNo: number,
  options: Pick<RetryPolicyOptions, 'random' | 'baseDelaySeconds' | 'maxDelaySeconds'> = {},
): number {
  if (!Number.isInteger(attemptNo) || attemptNo < 1) {
    throw new TypeError('Attempt number must be a positive integer.')
  }

  const random = options.random ?? Math.random
  const baseDelaySeconds = options.baseDelaySeconds ?? DEFAULT_BASE_DELAY_SECONDS
  const maxDelaySeconds = options.maxDelaySeconds ?? DEFAULT_MAX_DELAY_SECONDS

  if (
    !Number.isInteger(baseDelaySeconds) ||
    baseDelaySeconds < 1 ||
    !Number.isInteger(maxDelaySeconds) ||
    maxDelaySeconds < baseDelaySeconds
  ) {
    throw new TypeError(
      'Retry delays must be positive integers with the maximum at least equal to the base.',
    )
  }

  const randomValue = random()

  if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue >= 1) {
    throw new TypeError('Retry random source must return a number from 0 inclusive to 1 exclusive.')
  }

  const exponent = Math.min(attemptNo - 1, 30)
  const ceiling = Math.min(maxDelaySeconds, baseDelaySeconds * 2 ** exponent)

  return Math.max(1, Math.ceil(randomValue * ceiling))
}

export function decideHttpRetry(
  statusCode: number,
  attemptNo: number,
  options: RetryPolicyOptions = {},
): RetryDecision {
  const outcome = classifyHttpStatus(statusCode)

  if (outcome !== 'transient_failure') {
    return {
      outcome,
      retryable: false,
      delaySeconds: null,
    }
  }

  const retryAfter = parseRetryAfter(options.retryAfter ?? null, options.nowMilliseconds)

  return {
    outcome,
    retryable: true,
    delaySeconds: retryAfter ?? calculateBackoffDelay(attemptNo, options),
  }
}
