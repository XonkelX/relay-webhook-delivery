import { Hono } from 'hono'
import { ingestEvent } from '../lib/ingest-event.js'
import { parseIngestRequest } from '../lib/ingest-request.js'
import { publishEventOutbox } from '../lib/outbox-publisher.js'
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
      if (result.reason === 'quota_exceeded') {
        context.header('Cache-Control', 'no-store')

        return context.json(
          {
            error: {
              code: 'QUOTA_EXCEEDED',
              message:
                result.scope === 'api_key'
                  ? 'The API key daily event quota has been reached.'
                  : 'The Relay daily event quota has been reached.',
            },
          },
          429,
        )
      }

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

    const publication = await publishEventOutbox(
      context.env.DB,
      context.env.DELIVERY_QUEUE,
      result.value.eventId,
    )

    if (publication.failed > 0) {
      console.warn('Delivery outbox publication deferred', {
        eventId: result.value.eventId,
        failed: publication.failed,
      })
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
