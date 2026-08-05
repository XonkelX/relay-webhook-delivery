import { describe, expect, it, vi } from 'vitest'
import type { RelayDatabase, RelayStatement } from '../worker/lib/database.js'
import { publishEventOutbox, type DeliveryQueueProducer } from '../worker/lib/outbox-publisher.js'

interface PendingRow {
  id: string
  delivery_id: string
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
    return null
  }

  async all<T>(): Promise<{ results: T[] }> {
    return {
      results: this.database.pending as T[],
    }
  }

  async run(): Promise<unknown> {
    this.database.updates.push({
      query: this.query,
      values: this.values,
    })

    return { success: true }
  }
}

class FakeDatabase implements RelayDatabase {
  readonly pending: PendingRow[]
  readonly updates: Array<{
    query: string
    values: unknown[]
  }> = []

  constructor(pending: PendingRow[]) {
    this.pending = pending
  }

  prepare(query: string): RelayStatement {
    return new FakeStatement(query, this)
  }

  async batch(): Promise<unknown[]> {
    return []
  }
}

describe('delivery outbox publisher', () => {
  it('publishes pending delivery messages and marks them complete', async () => {
    const database = new FakeDatabase([
      {
        id: 'out_1',
        delivery_id: 'dlv_1',
      },
      {
        id: 'out_2',
        delivery_id: 'dlv_2',
      },
    ])

    const send = vi.fn().mockResolvedValue(undefined)
    const queue: DeliveryQueueProducer = { send }

    const result = await publishEventOutbox(database, queue, 'evt_1', '2026-08-05T09:00:00.000Z')

    expect(result).toEqual({
      published: 2,
      failed: 0,
    })

    expect(send).toHaveBeenNthCalledWith(
      1,
      {
        version: 1,
        deliveryId: 'dlv_1',
        reason: 'initial',
      },
      {
        contentType: 'json',
      },
    )

    expect(database.updates).toHaveLength(2)
    expect(database.updates[0]?.values).toEqual(['2026-08-05T09:00:00.000Z', 'out_1'])
  })

  it('retains a failed row and continues publishing later rows', async () => {
    const database = new FakeDatabase([
      {
        id: 'out_1',
        delivery_id: 'dlv_1',
      },
      {
        id: 'out_2',
        delivery_id: 'dlv_2',
      },
    ])

    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('queue unavailable'))
      .mockResolvedValueOnce(undefined)

    const result = await publishEventOutbox(database, { send }, 'evt_1')

    expect(result).toEqual({
      published: 1,
      failed: 1,
    })

    expect(send).toHaveBeenCalledTimes(2)
    expect(database.updates).toHaveLength(2)
    expect(database.updates[0]?.values).toEqual(['queue unavailable', 'out_1'])
  })

  it('performs no writes when the event has no pending rows', async () => {
    const database = new FakeDatabase([])
    const send = vi.fn()

    await expect(publishEventOutbox(database, { send }, 'evt_1')).resolves.toEqual({
      published: 0,
      failed: 0,
    })

    expect(send).not.toHaveBeenCalled()
    expect(database.updates).toHaveLength(0)
  })
})
