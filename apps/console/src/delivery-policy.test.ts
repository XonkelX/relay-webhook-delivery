import { describe, expect, it } from 'vitest'
import {
  calculateBackoffDelay,
  classifyHttpStatus,
  decideHttpRetry,
  parseRetryAfter,
} from '../worker/lib/delivery-policy.js'

describe('HTTP delivery classification', () => {
  it.each([200, 201, 204, 299])('classifies %s as success', (statusCode) => {
    expect(classifyHttpStatus(statusCode)).toBe('success')
  })

  it.each([408, 409, 425, 429, 500, 502, 503, 599])('classifies %s as transient', (statusCode) => {
    expect(classifyHttpStatus(statusCode)).toBe('transient_failure')
  })

  it.each([300, 400, 401, 403, 404, 410, 422])('classifies %s as permanent', (statusCode) => {
    expect(classifyHttpStatus(statusCode)).toBe('permanent_failure')
  })

  it.each([0, 99, 600, 200.5])('rejects invalid status %s', (statusCode) => {
    expect(() => classifyHttpStatus(statusCode)).toThrow(
      'HTTP status code must be an integer between 100 and 599.',
    )
  })
})

describe('Retry-After parsing', () => {
  it('parses delay seconds', () => {
    expect(parseRetryAfter('120')).toBe(120)
  })

  it('parses an HTTP date', () => {
    expect(
      parseRetryAfter('Wed, 05 Aug 2026 21:02:00 GMT', Date.parse('2026-08-05T21:00:00.000Z')),
    ).toBe(120)
  })

  it('rejects invalid values', () => {
    expect(parseRetryAfter('not-a-date')).toBeNull()
  })

  it('caps excessive delays at one day', () => {
    expect(parseRetryAfter('999999')).toBe(86_400)
  })
})

describe('Exponential backoff', () => {
  it('applies bounded full jitter', () => {
    expect(
      calculateBackoffDelay(1, {
        random: () => 0,
      }),
    ).toBe(1)

    expect(
      calculateBackoffDelay(4, {
        random: () => 0.5,
      }),
    ).toBe(20)

    expect(
      calculateBackoffDelay(20, {
        random: () => 0.999,
      }),
    ).toBeLessThanOrEqual(3600)
  })

  it('prefers Retry-After for transient responses', () => {
    expect(
      decideHttpRetry(429, 3, {
        retryAfter: '90',
        random: () => 0,
      }),
    ).toEqual({
      outcome: 'transient_failure',
      retryable: true,
      delaySeconds: 90,
    })
  })

  it('does not retry successful or permanent responses', () => {
    expect(decideHttpRetry(204, 1)).toEqual({
      outcome: 'success',
      retryable: false,
      delaySeconds: null,
    })

    expect(decideHttpRetry(410, 1)).toEqual({
      outcome: 'permanent_failure',
      retryable: false,
      delaySeconds: null,
    })
  })
})
