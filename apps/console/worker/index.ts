import { Hono } from 'hono'
import { requireApiKey, type RelayWorkerEnvironment } from './middleware/require-api-key.js'
import { enforceSameOriginApi, securityHeaders } from './middleware/security-http.js'
import { publishPendingOutbox } from './lib/outbox-publisher.js'
import { handleDeliveryQueue } from './queue-handler.js'
import { eventsRoute } from './routes/events.js'
import { ownerRoute } from './routes/owner.js'

const app = new Hono<RelayWorkerEnvironment>()

app.use('*', securityHeaders)
app.use('/api/*', enforceSameOriginApi)
app.use('/v1/*', enforceSameOriginApi)

app.get('/api/health', (context) =>
  context.json({
    status: 'ok',
    service: 'relay-console',
  }),
)

app.use('/v1/*', requireApiKey)
app.route('/v1/events', eventsRoute)
app.route('/api/owner', ownerRoute)

app.onError((error, context) => {
  console.error('Unhandled Relay Worker error', error)

  context.header('Cache-Control', 'no-store')

  return context.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'The request could not be completed.',
      },
    },
    500,
  )
})

app.notFound((context) =>
  context.json(
    {
      error: 'Not found',
    },
    404,
  ),
)

const worker = Object.assign(app, {
  queue(batch: MessageBatch<unknown>, env: RelayWorkerEnvironment['Bindings']): Promise<void> {
    return handleDeliveryQueue(batch, env)
  },

  scheduled(
    controller: ScheduledController,
    env: RelayWorkerEnvironment['Bindings'],
    context: ExecutionContext,
  ): void {
    const scheduledAt = new Date(controller.scheduledTime).toISOString()

    context.waitUntil(
      publishPendingOutbox(env.DB, env.DELIVERY_QUEUE, 100, scheduledAt).then((result) => {
        if (result.failed > 0) {
          console.warn('Scheduled outbox publication incomplete', {
            published: result.published,
            failed: result.failed,
          })
        }
      }),
    )
  },
})

export default worker
