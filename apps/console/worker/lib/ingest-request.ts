import {
  IdempotencyKeySchema,
  IngestEventRequestSchema,
  MAX_EVENT_PAYLOAD_BYTES,
  type IngestEventRequest,
} from '@relay/contracts'

export interface ParsedIngestRequest {
  idempotencyKey: string
  event: IngestEventRequest
  payloadJson: string
  payloadBytes: number
}

export interface IngestRequestError {
  status: 400 | 413 | 415 | 422
  code:
    | 'UNSUPPORTED_MEDIA_TYPE'
    | 'IDEMPOTENCY_KEY_REQUIRED'
    | 'INVALID_IDEMPOTENCY_KEY'
    | 'PAYLOAD_TOO_LARGE'
    | 'INVALID_JSON'
    | 'INVALID_EVENT'
  message: string
}

export type ParseIngestRequestResult =
  | {
      ok: true
      value: ParsedIngestRequest
    }
  | {
      ok: false
      error: IngestRequestError
    }

function failure(
  status: IngestRequestError['status'],
  code: IngestRequestError['code'],
  message: string,
): ParseIngestRequestResult {
  return {
    ok: false,
    error: {
      status,
      code,
      message,
    },
  }
}

export async function parseIngestRequest(request: Request): Promise<ParseIngestRequestResult> {
  const contentType = request.headers.get('Content-Type')

  if (!contentType || !contentType.toLowerCase().startsWith('application/json')) {
    return failure(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.')
  }

  const rawIdempotencyKey = request.headers.get('Idempotency-Key')

  if (rawIdempotencyKey === null) {
    return failure(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key is required.')
  }

  const idempotencyResult = IdempotencyKeySchema.safeParse(rawIdempotencyKey)

  if (!idempotencyResult.success) {
    return failure(
      400,
      'INVALID_IDEMPOTENCY_KEY',
      'Idempotency-Key must contain between 1 and 200 characters.',
    )
  }

  const body = await request.arrayBuffer()
  const payloadBytes = body.byteLength

  if (payloadBytes > MAX_EVENT_PAYLOAD_BYTES) {
    return failure(
      413,
      'PAYLOAD_TOO_LARGE',
      `Request body exceeds the ${MAX_EVENT_PAYLOAD_BYTES}-byte limit.`,
    )
  }

  const payloadJson = new TextDecoder().decode(body)

  let parsedJson: unknown

  try {
    parsedJson = JSON.parse(payloadJson)
  } catch {
    return failure(400, 'INVALID_JSON', 'Request body must contain valid JSON.')
  }

  const eventResult = IngestEventRequestSchema.safeParse(parsedJson)

  if (!eventResult.success) {
    return failure(422, 'INVALID_EVENT', 'Request body does not match the Relay event contract.')
  }

  return {
    ok: true,
    value: {
      idempotencyKey: idempotencyResult.data,
      event: eventResult.data,
      payloadJson,
      payloadBytes,
    },
  }
}
