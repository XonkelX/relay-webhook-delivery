import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import type { ApiKeyDatabase } from '../worker/lib/api-key-auth.js'
import { requireApiKey, type RelayWorkerEnvironment } from '../worker/middleware/require-api-key.js'

interface FakeApiKeyRow {
  id: string
  name: string
  key_prefix: string
  status: 'active' | 'revoked'
}

function createDatabase(row: FakeApiKeyRow | null) {
  const updateRun = vi.fn().mockResolvedValue({ success: true })

  const database: ApiKeyDatabase = {
    prepare(query: string) {
      return {
        bind() {
          return {
            first: async <T>() => (query.includes('SELECT') ? (row as T | null) : null),
            run: updateRun,
          }
        },
      }
    },
  }

  return {
    database,
    updateRun,
  }
}

function createProtectedApp() {
  const app = new Hono<RelayWorkerEnvironment>()

  app.use('/protected', requireApiKey)

  app.get('/protected', (context) =>
    context.json({
      apiKey: context.get('apiKey'),
    }),
  )

  return app
}

describe('API-key HTTP middleware', () => {
  it('returns 401 when authorization is missing', async () => {
    const app = createProtectedApp()
    const { database } = createDatabase(null)

    const response = await app.request('/protected', {}, { DB: database })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      error: {
        code: 'UNAUTHORIZED',
        message: 'A valid Relay API key is required.',
      },
    })
  })

  it('returns the same public error for an unknown key', async () => {
    const app = createProtectedApp()
    const { database } = createDatabase(null)

    const response = await app.request(
      '/protected',
      {
        headers: {
          Authorization: `Bearer rly_live_${'a'.repeat(64)}`,
        },
      },
      { DB: database },
    )

    expect(response.status).toBe(401)
  })

  it('exposes an authenticated active key to downstream handlers', async () => {
    const app = createProtectedApp()
    const { database, updateRun } = createDatabase({
      id: 'key_123',
      name: 'Production',
      key_prefix: 'rly_live_bbbbbbb',
      status: 'active',
    })

    const response = await app.request(
      '/protected',
      {
        headers: {
          Authorization: `Bearer rly_live_${'b'.repeat(64)}`,
        },
      },
      { DB: database },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      apiKey: {
        id: 'key_123',
        name: 'Production',
        keyPrefix: 'rly_live_bbbbbbb',
      },
    })
    expect(updateRun).toHaveBeenCalledOnce()
  })
})
