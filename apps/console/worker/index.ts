import { Hono } from 'hono'

const app = new Hono<{ Bindings: Env }>()

app.get('/api/health', (c) =>
  c.json({
    status: 'ok',
    service: 'relay-console',
  }),
)

app.notFound((c) => c.json({ error: 'Not found' }, 404))

export default app
