import { Hono } from 'hono'
import { listOwnerEvents, parseOwnerEventListQuery } from '../lib/owner-events.js'
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
