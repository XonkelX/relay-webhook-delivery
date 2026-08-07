import type { JsonValue } from '@relay/contracts'
import { describe, expect, it } from 'vitest'
import { sha256Hex } from '../worker/lib/auth.js'
import { canonicalizeJson } from '../worker/lib/canonical-json.js'
import type { RelayDatabase, RelayStatement } from '../worker/lib/database.js'
import { ingestEvent, type IngestEventDependencies } from '../worker/lib/ingest-event.js'
import type { ParsedIngestRequest } from '../worker/lib/ingest-request.js'

interface ExistingEvent {
  id: string
  event_type: string
  payload_sha256: string
  created_at: string
}

interface FakeDatabaseOptions {
  existingEvents?: Array<ExistingEvent | null>
  endpoints?: string[]
  deliveryCount?: number
  batchError?: Error
}

class FakeStatement implements RelayStatement {
  values: unknown[] = []
  readonly query: string
  private readonly database: FakeDatabase

  constructor(query: string, database: FakeDatabase) {
    this.query = query
    this.database = database
  }

  bind(...values: unknown[]): RelayStatement {
    this.values = values
    return this
  }

  async first<T>(): Promise<T | null> {
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

    throw new Error(`Unexpected all query: ${this.query}`)
  }

  async run(): Promise<unknown> {
    return { success: true }
  }
}

class FakeDatabase implements RelayDatabase {
  readonly prepared: FakeStatement[] = []
  batched: FakeStatement[] = []

  readonly existingEvents: Array<ExistingEvent | null>
  readonly endpoints: string[]
  readonly deliveryCount: number

  private readonly options: FakeDatabaseOptions

  constructor(options: FakeDatabaseOptions = {}) {
    this.options = options
    this.existingEvents = [...(options.existingEvents ?? [null])]
    this.endpoints = options.endpoints ?? []
    this.deliveryCount = options.deliveryCount ?? 0
  }

  prepare(query: string): RelayStatement {
    const statement = new FakeStatement(query, this)
    this.prepared.push(statement)
    return statement
  }

  async batch(statements: RelayStatement[]): Promise<unknown[]> {
    this.batched = statements as FakeStatement[]

    if (this.options.batchError) {
      throw this.options.batchError
    }

    return statements.map(() => ({ success: true }))
  }
}

const createdAt = '2026-08-05T08:30:00.000Z'

const request: ParsedIngestRequest = {
  idempotencyKey: 'request-123',
  event: {
    type: 'invoice.payment_failed',
    data: {
      invoiceId: 'inv_123',
      amount: 4200,
    },
  },
  payloadJson: '{"type":"invoice.payment_failed"}',
  payloadBytes: 96,
}

function deterministicDependencies(): IngestEventDependencies {
  const counters = new Map<string, number>()

  return {
    now: () => createdAt,
    createId: (prefix) => {
      const next = (counters.get(prefix) ?? 0) + 1
      counters.set(prefix, next)
      return `${prefix}_${next}`
    },
  }
}

async function payloadHash(type: string, data: JsonValue): Promise<string> {
  return sha256Hex(
    canonicalizeJson({
      type,
      data,
    }),
  )
}

describe('atomic event ingestion', () => {
  it('creates an event, deliveries, outbox rows, usage, and audit atomically', async () => {
    const database = new FakeDatabase({
      endpoints: ['ep_orders', 'ep_billing'],
    })

    const result = await ingestEvent(
      database,
      'key_production',
      request,
      deterministicDependencies(),
    )

    expect(result).toEqual({
      ok: true,
      value: {
        eventId: 'evt_1',
        duplicate: false,
        deliveryCount: 2,
        createdAt,
      },
    })

    expect(database.batched).toHaveLength(8)

    const queries = database.batched.map((statement) => statement.query.replace(/\s+/g, ' '))

    expect(queries.filter((query) => query.includes('INSERT INTO events'))).toHaveLength(1)
    expect(queries.filter((query) => query.includes('INSERT INTO deliveries'))).toHaveLength(2)
    expect(queries.filter((query) => query.includes('INSERT INTO delivery_outbox'))).toHaveLength(2)
    expect(queries.filter((query) => query.includes('INSERT INTO daily_usage'))).toHaveLength(1)
    expect(
      queries.filter((query) => query.includes('INSERT INTO global_daily_usage')),
    ).toHaveLength(1)
    expect(queries.filter((query) => query.includes('INSERT INTO audit_log'))).toHaveLength(1)

    const eventInsert = database.batched.find((statement) =>
      statement.query.includes('INSERT INTO events'),
    )

    expect(eventInsert?.values).toEqual([
      'evt_1',
      'key_production',
      'request-123',
      'invoice.payment_failed',
      '{"amount":4200,"invoiceId":"inv_123"}',
      expect.stringMatching(/^[a-f0-9]{64}$/),
      96,
      createdAt,
    ])
  })

  it('accepts a repeated idempotent request without creating new rows', async () => {
    const hash = await payloadHash(request.event.type, request.event.data)

    const database = new FakeDatabase({
      existingEvents: [
        {
          id: 'evt_existing',
          event_type: request.event.type,
          payload_sha256: hash,
          created_at: createdAt,
        },
      ],
      deliveryCount: 3,
    })

    const result = await ingestEvent(database, 'key_production', request)

    expect(result).toEqual({
      ok: true,
      value: {
        eventId: 'evt_existing',
        duplicate: true,
        deliveryCount: 3,
        createdAt,
      },
    })

    expect(database.batched).toHaveLength(0)
  })

  it('rejects reuse of an idempotency key with conflicting content', async () => {
    const database = new FakeDatabase({
      existingEvents: [
        {
          id: 'evt_existing',
          event_type: request.event.type,
          payload_sha256: 'f'.repeat(64),
          created_at: createdAt,
        },
      ],
    })

    await expect(ingestEvent(database, 'key_production', request)).resolves.toEqual({
      ok: false,
      reason: 'idempotency_conflict',
    })

    expect(database.batched).toHaveLength(0)
  })

  it('accepts an event with zero matching subscriptions', async () => {
    const database = new FakeDatabase({
      endpoints: [],
    })

    const result = await ingestEvent(
      database,
      'key_production',
      request,
      deterministicDependencies(),
    )

    expect(result).toMatchObject({
      ok: true,
      value: {
        deliveryCount: 0,
      },
    })

    expect(database.batched).toHaveLength(4)
    expect(
      database.batched.some((statement) => statement.query.includes('INSERT INTO deliveries')),
    ).toBe(false)
  })

  it('propagates a failed atomic batch when no concurrent event exists', async () => {
    const database = new FakeDatabase({
      endpoints: ['ep_orders'],
      existingEvents: [null, null],
      batchError: new Error('transaction rolled back'),
    })

    await expect(
      ingestEvent(database, 'key_production', request, deterministicDependencies()),
    ).rejects.toThrow('transaction rolled back')
  })

  it('reconciles a concurrent request that wins the idempotency race', async () => {
    const hash = await payloadHash(request.event.type, request.event.data)

    const database = new FakeDatabase({
      endpoints: ['ep_orders'],
      existingEvents: [
        null,
        {
          id: 'evt_winner',
          event_type: request.event.type,
          payload_sha256: hash,
          created_at: createdAt,
        },
      ],
      deliveryCount: 1,
      batchError: new Error('unique constraint failed'),
    })

    const result = await ingestEvent(
      database,
      'key_production',
      request,
      deterministicDependencies(),
    )

    expect(result).toEqual({
      ok: true,
      value: {
        eventId: 'evt_winner',
        duplicate: true,
        deliveryCount: 1,
        createdAt,
      },
    })
  })
})
