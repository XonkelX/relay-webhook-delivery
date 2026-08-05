import { createMiddleware } from 'hono/factory'
import { authenticateApiKey, type AuthenticatedApiKey } from '../lib/api-key-auth.js'
import type { RelayDatabase } from '../lib/database.js'
import type { DeliveryQueueProducer } from '../lib/outbox-publisher.js'

export interface RelayWorkerEnvironment {
  Bindings: {
    DB: RelayDatabase
    DELIVERY_QUEUE: DeliveryQueueProducer
  }
  Variables: {
    apiKey: AuthenticatedApiKey
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
