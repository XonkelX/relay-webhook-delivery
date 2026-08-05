import { Hono } from 'hono'
import { requireApiKey, type RelayWorkerEnvironment } from './middleware/require-api-key.js'

const app = new Hono<RelayWorkerEnvironment>()

app.get('/api/health', (context) =>
  context.json({
    status: 'ok',
    service: 'relay-console',
  }),
)

app.use('/v1/*', requireApiKey)

app.notFound((context) => context.json({ error: 'Not found' }, 404))

export default app
