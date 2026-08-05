import { Hono } from 'hono'
import { ingestEvent } from '../lib/ingest-event.js'
import { parseIngestRequest } from '../lib/ingest-request.js'
import type { RelayWorkerEnvironment } from '../middleware/require-api-key.js'

export const eventsRoute = new Hono<RelayWorkerEnvironment>()

eventsRoute.post('/', async (context) => {
  const parsed = await parseIngestRequest(context.req.raw)

  if (!parsed.ok) {
    return context.json(
      {
        error: {
          code: parsed.error.code,
          message: parsed.error.message,
        },
      },
      parsed.error.status,
    )
  }

  try {
    const result = await ingestEvent(context.env.DB, context.get('apiKey').id, parsed.value)

    if (!result.ok) {
      return context.json(
        {
          error: {
            code: 'IDEMPOTENCY_CONFLICT',
            message: 'The idempotency key was already used with different event content.',
          },
        },
        409,
      )
    }

    return context.json(
      {
        eventId: result.value.eventId,
        status: 'accepted',
        duplicate: result.value.duplicate,
        deliveryCount: result.value.deliveryCount,
        createdAt: result.value.createdAt,
      },
      202,
    )
  } catch (error) {
    console.error('Event ingestion failed', error)

    return context.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'The event could not be accepted.',
        },
      },
      500,
    )
  }
})
