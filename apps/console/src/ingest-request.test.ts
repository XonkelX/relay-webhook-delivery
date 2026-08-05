import { MAX_EVENT_PAYLOAD_BYTES, type IngestEventRequest } from '@relay/contracts'
import { describe, expect, it } from 'vitest'
import { parseIngestRequest } from '../worker/lib/ingest-request.js'

function createRequest(body: string, headers: Record<string, string> = {}) {
  return new Request('https://relay.test/v1/events', {
    method: 'POST',
    headers,
    body,
  })
}

const validEvent: IngestEventRequest = {
  type: 'invoice.payment_failed',
  data: {
    invoiceId: 'inv_123',
  },
}

describe('event ingestion request parsing', () => {
  it('accepts a valid event request', async () => {
    const body = JSON.stringify(validEvent)

    const result = await parseIngestRequest(
      createRequest(body, {
        'Content-Type': 'application/json; charset=utf-8',
        'Idempotency-Key': ' request-123 ',
      }),
    )

    expect(result).toEqual({
      ok: true,
      value: {
        idempotencyKey: 'request-123',
        event: validEvent,
        payloadJson: body,
        payloadBytes: new TextEncoder().encode(body).byteLength,
      },
    })
  })

  it('requires JSON content type', async () => {
    const result = await parseIngestRequest(
      createRequest(JSON.stringify(validEvent), {
        'Idempotency-Key': 'request-123',
      }),
    )

    expect(result).toMatchObject({
      ok: false,
      error: {
        status: 415,
        code: 'UNSUPPORTED_MEDIA_TYPE',
      },
    })
  })

  it('requires an idempotency key', async () => {
    const result = await parseIngestRequest(
      createRequest(JSON.stringify(validEvent), {
        'Content-Type': 'application/json',
      }),
    )

    expect(result).toMatchObject({
      ok: false,
      error: {
        status: 400,
        code: 'IDEMPOTENCY_KEY_REQUIRED',
      },
    })
  })

  it('rejects an empty idempotency key', async () => {
    const result = await parseIngestRequest(
      createRequest(JSON.stringify(validEvent), {
        'Content-Type': 'application/json',
        'Idempotency-Key': '   ',
      }),
    )

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'INVALID_IDEMPOTENCY_KEY',
      },
    })
  })

  it('rejects an oversized body', async () => {
    const oversizedBody = JSON.stringify({
      type: 'order.completed',
      data: 'x'.repeat(MAX_EVENT_PAYLOAD_BYTES),
    })

    const result = await parseIngestRequest(
      createRequest(oversizedBody, {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'request-123',
      }),
    )

    expect(result).toMatchObject({
      ok: false,
      error: {
        status: 413,
        code: 'PAYLOAD_TOO_LARGE',
      },
    })
  })

  it('rejects malformed JSON', async () => {
    const result = await parseIngestRequest(
      createRequest('{"type":', {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'request-123',
      }),
    )

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'INVALID_JSON',
      },
    })
  })

  it('rejects JSON that violates the event contract', async () => {
    const result = await parseIngestRequest(
      createRequest(
        JSON.stringify({
          type: 'Invoice Failed',
          data: {},
        }),
        {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'request-123',
        },
      ),
    )

    expect(result).toMatchObject({
      ok: false,
      error: {
        status: 422,
        code: 'INVALID_EVENT',
      },
    })
  })
})
