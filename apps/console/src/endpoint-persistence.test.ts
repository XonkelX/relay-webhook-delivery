import { describe, expect, it } from 'vitest'
import type { RelayDatabase, RelayStatement } from '../worker/lib/database.js'
import { createEndpoint, replaceEndpointSubscriptions } from '../worker/lib/endpoint-persistence.js'

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
    if (this.query.includes('FROM endpoints')) {
      return this.database.endpointExists ? ({ id: 'ep_existing' } as T) : null
    }

    return null
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: [] }
  }

  async run(): Promise<unknown> {
    return { success: true }
  }
}

class FakeDatabase implements RelayDatabase {
  readonly endpointExists: boolean
  batched: RelayStatement[] = []

  constructor(endpointExists = true) {
    this.endpointExists = endpointExists
  }

  prepare(query: string): RelayStatement {
    return new FakeStatement(query, this)
  }

  async batch(statements: RelayStatement[]): Promise<unknown[]> {
    this.batched = statements
    return statements.map(() => ({ success: true }))
  }
}

describe('endpoint persistence', () => {
  it('creates a pending endpoint and subscriptions atomically', async () => {
    const database = new FakeDatabase()

    const result = await createEndpoint(
      database,
      {
        name: '  Billing webhook  ',
        url: 'https://hooks.example.test/billing',
        eventTypes: ['invoice.paid', 'invoice.created', 'invoice.paid'],
      },
      {
        now: () => '2026-08-05T12:00:00.000Z',
        createId: (prefix) => `${prefix}_created`,
      },
    )

    expect(result).toEqual({
      id: 'ep_created',
      name: 'Billing webhook',
      url: 'https://hooks.example.test/billing',
      status: 'pending',
      eventTypes: ['invoice.created', 'invoice.paid'],
      createdAt: '2026-08-05T12:00:00.000Z',
    })

    expect(database.batched).toHaveLength(4)
  })

  it('replaces subscriptions in one batch', async () => {
    const database = new FakeDatabase()

    await expect(
      replaceEndpointSubscriptions(
        database,
        'ep_existing',
        ['payment.failed', 'payment.failed', 'payment.succeeded'],
        {
          now: () => '2026-08-05T12:05:00.000Z',
          createId: () => 'aud_updated',
        },
      ),
    ).resolves.toEqual({
      updated: true,
      eventTypes: ['payment.failed', 'payment.succeeded'],
    })

    expect(database.batched).toHaveLength(4)
  })

  it('returns false when replacing subscriptions for a missing endpoint', async () => {
    const database = new FakeDatabase(false)

    await expect(
      replaceEndpointSubscriptions(database, 'ep_missing', ['invoice.created']),
    ).resolves.toEqual({
      updated: false,
      eventTypes: ['invoice.created'],
    })

    expect(database.batched).toHaveLength(0)
  })

  it.each([
    {
      name: '',
      url: 'https://example.test',
      eventTypes: [],
    },
    {
      name: 'Endpoint',
      url: 'ftp://example.test/file',
      eventTypes: [],
    },
    {
      name: 'Endpoint',
      url: 'https://user:secret@example.test',
      eventTypes: [],
    },
    {
      name: 'Endpoint',
      url: 'https://example.test',
      eventTypes: [''],
    },
  ])('rejects invalid endpoint input %#', async (input) => {
    await expect(createEndpoint(new FakeDatabase(), input)).rejects.toBeInstanceOf(TypeError)
  })
})
