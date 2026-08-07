import { EventIdSchema } from '@relay/contracts'
import { Hono } from 'hono'
import { listOwnerEvents, parseOwnerEventListQuery } from '../lib/owner-events.js'
import { loadOwnerEventDetail } from '../lib/owner-event-detail.js'
import { listOwnerEndpoints } from '../lib/owner-endpoints.js'
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
