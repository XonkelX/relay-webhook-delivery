import { Hono } from 'hono'
import { buildExpiredOwnerCookies } from '../lib/owner-session-http.js'
import { revokeOwnerSession } from '../lib/owner-session.js'
import { requireOwnerSession } from '../middleware/require-owner-session.js'
import type { RelayWorkerEnvironment } from '../middleware/require-api-key.js'

export const ownerRoute = new Hono<RelayWorkerEnvironment>()

ownerRoute.use('*', requireOwnerSession)

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
