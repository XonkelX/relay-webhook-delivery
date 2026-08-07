import { describe, expect, it } from 'vitest'
import {
  buildSafeRequestHeaders,
  explainDeliveryRetry,
  parseSafeResponseHeaders,
  sanitizePayloadForInspector,
} from '../worker/lib/inspector-evidence.js'

describe('inspector evidence', () => {
  it('redacts credential-shaped payload fields recursively', () => {
    expect(
      sanitizePayloadForInspector({
        customer: 'cus_123',
        authorization: 'Bearer secret',
        nested: {
          apiKey: 'api-secret',
          ordinary: 42,
        },
        items: [
          {
            access_token: 'token-secret',
            name: 'visible',
          },
        ],
      }),
    ).toEqual({
      customer: 'cus_123',
      authorization: '[REDACTED]',
      nested: {
        apiKey: '[REDACTED]',
        ordinary: 42,
      },
      items: [
        {
          access_token: '[REDACTED]',
          name: 'visible',
        },
      ],
    })
  })

  it('reconstructs safe request evidence without exposing signatures', () => {
    expect(buildSafeRequestHeaders('msg_inspector123', '2026-08-07T05:03:00.000Z')).toMatchObject({
      'content-type': 'application/json',
      'user-agent': 'Relay-Webhooks/1.0',
      'webhook-id': 'msg_inspector123',
      'webhook-signature': '[REDACTED]',
    })
  })

  it('re-sanitizes persisted response headers before browser exposure', () => {
    expect(
      parseSafeResponseHeaders(
        JSON.stringify({
          authorization: 'Bearer database-secret',
          'set-cookie': 'session=database-secret',
          'x-request-id': 'req_123',
          'x-untrusted-header': 'drop-me',
        }),
      ),
    ).toEqual({
      authorization: '[REDACTED]',
      'set-cookie': '[REDACTED]',
      'x-request-id': 'req_123',
    })
  })

  it('explains a scheduled transient retry in plain language', () => {
    expect(
      explainDeliveryRetry({
        status: 'retrying',
        attemptCount: 2,
        nextAttemptAt: '2026-08-07T05:10:00.000Z',
        replayOfDeliveryId: null,
        lastErrorClass: 'http_503',
        latestAttempt: {
          outcome: 'transient_failure',
          statusCode: 503,
          completedAt: '2026-08-07T05:03:00.000Z',
          errorClass: 'http_503',
        },
      }),
    ).toBe('HTTP 503 is transient. Attempt 3 is scheduled in 7 minutes.')
  })
})
