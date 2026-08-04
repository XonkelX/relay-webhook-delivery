import { Hono } from 'hono'

const app = new Hono()

app.get('/health', (c) =>
  c.json({
    status: 'ok',
    service: 'relay-lab',
  }),
)

app.notFound((c) => c.json({ error: 'Not found' }, 404))

export default app
