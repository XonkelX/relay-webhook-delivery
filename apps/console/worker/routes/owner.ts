import { DeliveryIdSchema, EventIdSchema } from '@relay/contracts'
import { Hono } from 'hono'
import { listOwnerEvents, parseOwnerEventListQuery } from '../lib/owner-events.js'
import { loadOwnerEventDetail } from '../lib/owner-event-detail.js'
import { listOwnerEndpoints } from '../lib/owner-endpoints.js'
import { loadOwnerSystemHealth } from '../lib/owner-health.js'
import { loadOwnerOverview } from '../lib/owner-overview.js'
import { publishDeliveryOutbox } from '../lib/outbox-publisher.js'
import { replayDelivery } from '../lib/replay-delivery.js'
import { buildExpiredOwnerCookies } from '../lib/owner-session-http.js'
import { revokeOwnerSession } from '../lib/owner-session.js'
import { requireOwnerSession } from '../middleware/require-owner-session.js'
import type { RelayWorkerEnvironment } from '../middleware/require-api-key.js'

export const ownerRoute = new Hono<RelayWorkerEnvironment>()

ownerRoute.use('*', requireOwnerSession)

ownerRoute.get('/events', async (context) => {
  let options

  try {
    options = parseOwnerEventListQuery(context.req.url)
  } catch {
    return context.json(
      {
        error: {
          code: 'INVALID_QUERY',
          message: 'The event query parameters are invalid.',
        },
      },
      400,
    )
  }

  const result = await listOwnerEvents(context.env.DB, options)

  return context.json(result)
})

ownerRoute.get('/events/:eventId', async (context) => {
  const eventId = context.req.param('eventId')

  if (!EventIdSchema.safeParse(eventId).success) {
    return context.json(
      {
        error: {
          code: 'INVALID_EVENT_ID',
          message: 'The event identifier is invalid.',
        },
      },
      400,
    )
  }

  const result = await loadOwnerEventDetail(context.env.DB, eventId)

  if (!result) {
    return context.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: 'Event not found.',
        },
      },
      404,
    )
  }

  return context.json(result)
})
ownerRoute.get('/endpoints', async (context) => {
  const result = await listOwnerEndpoints(context.env.DB)

  return context.json(result)
})
ownerRoute.get('/overview', async (context) => {
  const result = await loadOwnerOverview(context.env.DB)

  return context.json(result)
})

ownerRoute.get('/health', async (context) => {
  const result = await loadOwnerSystemHealth(context.env.DB)

  return context.json(result)
})
ownerRoute.post('/deliveries/:deliveryId/replay', async (context) => {
  const deliveryId = context.req.param('deliveryId')

  if (!DeliveryIdSchema.safeParse(deliveryId).success) {
    return context.json(
      {
        error: {
          code: 'INVALID_DELIVERY_ID',
          message: 'The delivery identifier is invalid.',
        },
      },
      400,
    )
  }

  const result = await replayDelivery(context.env.DB, deliveryId)

  if (!result.ok) {
    if (result.reason === 'missing') {
      return context.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: 'Delivery not found.',
          },
        },
        404,
      )
    }

    if (result.reason === 'source_not_terminal') {
      return context.json(
        {
          error: {
            code: 'DELIVERY_NOT_REPLAYABLE',
            message: 'Only terminal deliveries can be replayed.',
          },
        },
        409,
      )
    }

    return context.json(
      {
        error: {
          code: 'ENDPOINT_INACTIVE',
          message: 'The endpoint must be active before replaying a delivery.',
        },
      },
      409,
    )
  }

  await publishDeliveryOutbox(
    context.env.DB,
    context.env.DELIVERY_QUEUE,
    result.value.deliveryId,
    result.value.createdAt,
  )

  return context.json(result.value, 202)
})
ownerRoute.post('/logout', async (context) => {
  const rawToken = context.get('ownerSessionRawToken')

  await revokeOwnerSession(context.env.DB, rawToken)

  const headers = new Headers()
  headers.set('Cache-Control', 'no-store')

  for (const cookie of buildExpiredOwnerCookies()) {
    headers.append('Set-Cookie', cookie)
  }

  return new Response(null, {
    status: 204,
    headers,
  })
})
