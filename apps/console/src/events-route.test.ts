import { describe, expect, it, vi } from 'vitest'
import app from '../worker/index.js'
import type { RelayDatabase, RelayStatement } from '../worker/lib/database.js'

interface ExistingEventRow {
  id: string
  event_type: string
  payload_sha256: string
  created_at: string
}

interface FakeDatabaseOptions {
  authenticated?: boolean
  existingEvents?: Array<ExistingEventRow | null>
  endpoints?: string[]
  deliveryCount?: number
  batchError?: Error
}

class FakeStatement implements RelayStatement {
  readonly query: string
  readonly database: FakeDatabase
  values: unknown[] = []

  constructor(query: string, database: FakeDatabase) {
    this.query = query
    this.database = database
  }

  bind(...values: unknown[]): RelayStatement {
    this.values = values
    return this
  }

  async first<T>(): Promise<T | null> {
    if (this.query.includes('FROM api_keys')) {
      if (!this.database.authenticated) {
        return null
      }

      return {
        id: 'key_production',
        name: 'Production',
        key_prefix: 'rly_live_aaaaaaa',
        status: 'active',
      } as T
    }

    if (this.query.includes('FROM events')) {
      return (this.database.existingEvents.shift() ?? null) as T | null
    }

    if (this.query.includes('COUNT(*) AS delivery_count')) {
      return {
        delivery_count: this.database.deliveryCount,
      } as T
    }

    throw new Error(`Unexpected first query: ${this.query}`)
  }

  async all<T>(): Promise<{ results: T[] }> {
    if (this.query.includes('FROM endpoints')) {
      return {
        results: this.database.endpoints.map((id) => ({ id })) as T[],
      }
    }

    if (this.query.includes('FROM delivery_outbox')) {
      return {
        results: [],
      }
    }

    throw new Error(`Unexpected all query: ${this.query}`)
  }

  async run(): Promise<unknown> {
    return { success: true }
  }
}

class FakeDatabase implements RelayDatabase {
  readonly authenticated: boolean
  readonly existingEvents: Array<ExistingEventRow | null>
  readonly endpoints: string[]
  readonly deliveryCount: number
  readonly batchError?: Error
  batched: RelayStatement[] = []

  constructor(options: FakeDatabaseOptions = {}) {
    this.authenticated = options.authenticated ?? true
    this.existingEvents = [...(options.existingEvents ?? [null])]
    this.endpoints = options.endpoints ?? []
    this.deliveryCount = options.deliveryCount ?? 0
    this.batchError = options.batchError
  }

  prepare(query: string): RelayStatement {
    return new FakeStatement(query, this)
  }

  async batch(statements: RelayStatement[]): Promise<unknown[]> {
    this.batched = statements

    if (this.batchError) {
      throw this.batchError
    }

    return statements.map(() => ({ success: true }))
  }
}

const authorization = `Bearer rly_live_${'a'.repeat(64)}`

function postEvent(
  database: RelayDatabase,
  options: {
    body?: string
    authorization?: string | null
    contentType?: string | null
    idempotencyKey?: string | null
  } = {},
) {
  const headers = new Headers()

  if (options.authorization !== null) {
    headers.set('Authorization', options.authorization ?? authorization)
  }

  if (options.contentType !== null) {
    headers.set('Content-Type', options.contentType ?? 'application/json')
  }

  if (options.idempotencyKey !== null) {
    headers.set('Idempotency-Key', options.idempotencyKey ?? 'request-123')
  }

  return app.request(
    '/v1/events',
    {
      method: 'POST',
      headers,
      body:
        options.body ??
        JSON.stringify({
          type: 'invoice.payment_failed',
          data: {
            invoiceId: 'inv_123',
          },
        }),
    },
    {
      DB: database,
      DELIVERY_QUEUE: {
        send: vi.fn().mockResolvedValue(undefined),
      },
    },
  )
}

describe('POST /v1/events', () => {
  it('requires API-key authentication', async () => {
    const response = await postEvent(new FakeDatabase(), {
      authorization: null,
    })

    expect(response.status).toBe(401)
  })

  it('returns structured request-validation errors', async () => {
    const response = await postEvent(new FakeDatabase(), {
      contentType: null,
    })

    expect(response.status).toBe(415)
    expect(await response.json()).toMatchObject({
      error: {
        code: 'UNSUPPORTED_MEDIA_TYPE',
      },
    })
  })

  it('accepts a new event and creates fanout records', async () => {
    const database = new FakeDatabase({
      endpoints: ['ep_orders', 'ep_billing'],
    })

    const response = await postEvent(database)
    const body = (await response.json()) as {
      eventId: string
      status: string
      duplicate: boolean
      deliveryCount: number
    }

    expect(response.status).toBe(202)
    expect(body).toMatchObject({
      status: 'accepted',
      duplicate: false,
      deliveryCount: 2,
    })
    expect(body.eventId).toMatch(/^evt_[a-f0-9]{32}$/)
    expect(database.batched).toHaveLength(7)
  })

  it('returns the original event for an idempotent retry', async () => {
    const database = new FakeDatabase({
      existingEvents: [
        {
          id: 'evt_existing',
          event_type: 'invoice.payment_failed',
          payload_sha256: 'fbd5eabb8761b0530ccec3c354131d10030c9244f2f4b92996341dae35efa32b',
          created_at: '2026-08-05T08:30:00.000Z',
        },
      ],
      deliveryCount: 2,
    })

    const response = await postEvent(database)

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({
      eventId: 'evt_existing',
      status: 'accepted',
      duplicate: true,
      deliveryCount: 2,
      createdAt: '2026-08-05T08:30:00.000Z',
    })
  })

  it('returns 409 for conflicting idempotency reuse', async () => {
    const database = new FakeDatabase({
      existingEvents: [
        {
          id: 'evt_existing',
          event_type: 'invoice.payment_failed',
          payload_sha256: 'f'.repeat(64),
          created_at: '2026-08-05T08:30:00.000Z',
        },
      ],
    })

    const response = await postEvent(database)

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      error: {
        code: 'IDEMPOTENCY_CONFLICT',
      },
    })
  })

  it('returns 500 without exposing persistence details', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const database = new FakeDatabase({
      existingEvents: [null, null],
      endpoints: ['ep_orders'],
      batchError: new Error('database unavailable'),
    })

    const response = await postEvent(database)

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'The event could not be accepted.',
      },
    })

    consoleError.mockRestore()
  })
})
