import { Hono } from 'hono'
import { requireApiKey, type RelayWorkerEnvironment } from './middleware/require-api-key.js'
import { publishPendingOutbox } from './lib/outbox-publisher.js'
import { handleDeliveryQueue } from './queue-handler.js'
import { eventsRoute } from './routes/events.js'

const app = new Hono<RelayWorkerEnvironment>()

app.get('/api/health', (context) =>
  context.json({
    status: 'ok',
    service: 'relay-console',
  }),
)

app.use('/v1/*', requireApiKey)
app.route('/v1/events', eventsRoute)

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
