import { Hono } from 'hono'
import { requireApiKey, type RelayWorkerEnvironment } from './middleware/require-api-key.js'
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

app.notFound((context) => context.json({ error: 'Not found' }, 404))

export default app
