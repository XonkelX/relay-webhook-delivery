import { createMiddleware } from 'hono/factory'
import { authenticateApiKey, type AuthenticatedApiKey } from '../lib/api-key-auth.js'
import type { RelayDatabase } from '../lib/database.js'
import type { AuthenticatedOwnerSession } from '../lib/owner-session.js'
import type { DeliveryQueueProducer } from '../lib/outbox-publisher.js'

export interface RelayWorkerEnvironment {
  Bindings: {
    DB: RelayDatabase
    DELIVERY_QUEUE: DeliveryQueueProducer
    ENDPOINT_SECRET_MASTER_KEY_V1?: string
    ENDPOINT_SECRET_MASTER_KEY_V2?: string
    OWNER_SESSION_SIGNING_KEY?: string
    OWNER_BOOTSTRAP_TOKEN?: string
  }
  Variables: {
    apiKey: AuthenticatedApiKey
    ownerSession: AuthenticatedOwnerSession
    ownerSessionRawToken: string
  }
}

export const requireApiKey = createMiddleware<RelayWorkerEnvironment>(async (context, next) => {
  const result = await authenticateApiKey(
    context.req.header('Authorization') ?? null,
    context.env.DB,
  )

  if (!result.ok) {
    context.header('Cache-Control', 'no-store')

    return context.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'A valid Relay API key is required.',
        },
      },
      401,
    )
  }

  context.set('apiKey', result.apiKey)
  await next()
})
