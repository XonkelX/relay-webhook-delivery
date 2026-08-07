import {
  DeliveryIdSchema,
  EventIdSchema,
  OwnerSessionBootstrapRequestSchema,
} from '@relay/contracts'
import { Hono } from 'hono'
import { listOwnerEvents, parseOwnerEventListQuery } from '../lib/owner-events.js'
import { loadOwnerEventDetail } from '../lib/owner-event-detail.js'
import { listOwnerEndpoints } from '../lib/owner-endpoints.js'
import { loadOwnerSystemHealth } from '../lib/owner-health.js'
import { loadOwnerOverview } from '../lib/owner-overview.js'
import { publishDeliveryOutbox } from '../lib/outbox-publisher.js'
import { replayDelivery } from '../lib/replay-delivery.js'
import {
  buildExpiredOwnerCookies,
  buildOwnerCsrfCookie,
  buildOwnerSessionCookie,
  createOwnerCsrfToken,
  createSignedOwnerSessionCookieValue,
} from '../lib/owner-session-http.js'
import { createOwnerSession, revokeOwnerSession } from '../lib/owner-session.js'
import { verifyOwnerBootstrapToken } from '../lib/owner-bootstrap.js'
import { requireOwnerSession } from '../middleware/require-owner-session.js'
import type { RelayWorkerEnvironment } from '../middleware/require-api-key.js'

export const ownerRoute = new Hono<RelayWorkerEnvironment>()

ownerRoute.post('/session', async (context) => {
  const bootstrapToken = context.env.OWNER_BOOTSTRAP_TOKEN
  const signingKey = context.env.OWNER_SESSION_SIGNING_KEY

  if (!bootstrapToken || !signingKey) {
    console.error('Owner bootstrap authentication is not configured.')

    return context.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Owner authentication is unavailable.',
        },
      },
      500,
    )
  }

  let request: unknown

  try {
    request = await context.req.json()
  } catch {
    request = null
  }

  const parsed = OwnerSessionBootstrapRequestSchema.safeParse(request)

  if (!parsed.success) {
    return context.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'The owner credentials are invalid.',
        },
      },
      401,
    )
  }

  let authenticated: boolean

  try {
    authenticated = await verifyOwnerBootstrapToken(parsed.data.token, bootstrapToken)
  } catch (error) {
    console.error('Owner bootstrap configuration is invalid.', error)

    return context.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Owner authentication is unavailable.',
        },
      },
      500,
    )
  }

  if (!authenticated) {
    return context.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'The owner credentials are invalid.',
        },
      },
      401,
    )
  }

  const session = await createOwnerSession(context.env.DB)

  const signedCookie = await createSignedOwnerSessionCookieValue(session.rawToken, signingKey)

  const csrf = await createOwnerCsrfToken(session.rawToken, signingKey)

  const maxAgeSeconds = Math.floor(
    (Date.parse(session.expiresAt) - Date.parse(session.createdAt)) / 1000,
  )

  context.header('Set-Cookie', buildOwnerSessionCookie(signedCookie, maxAgeSeconds), {
    append: true,
  })

  context.header('Set-Cookie', buildOwnerCsrfCookie(csrf, maxAgeSeconds), { append: true })

  return context.json(
    {
      status: 'authenticated',
      expiresAt: session.expiresAt,
    },
    201,
  )
})
ownerRoute.use('*', requireOwnerSession)
ownerRoute.get('/session', (context) => {
  const session = context.get('ownerSession')

  return context.json({
    status: 'authenticated',
    expiresAt: session.expiresAt,
  })
})

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
