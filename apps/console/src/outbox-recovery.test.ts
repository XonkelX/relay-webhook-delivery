import { describe, expect, it, vi } from 'vitest'
import type { RelayDatabase, RelayStatement } from '../worker/lib/database.js'
import { publishPendingOutbox, type DeliveryQueueProducer } from '../worker/lib/outbox-publisher.js'

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
    this.database.binds.push(values)
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
    return { success: true }
  }
}

class FakeDatabase implements RelayDatabase {
  readonly pending: PendingRow[]
  readonly binds: unknown[][] = []

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

describe('outbox recovery sweep', () => {
  it('publishes a bounded batch of available rows', async () => {
    const database = new FakeDatabase([
      {
        id: 'out_recovery_1',
        delivery_id: 'dlv_recovery_1',
      },
      {
        id: 'out_recovery_2',
        delivery_id: 'dlv_recovery_2',
      },
    ])

    const send = vi.fn().mockResolvedValue(undefined)
    const queue: DeliveryQueueProducer = { send }

    await expect(
      publishPendingOutbox(database, queue, 25, '2026-08-05T20:00:00.000Z'),
    ).resolves.toEqual({
      published: 2,
      failed: 0,
    })

    expect(database.binds[0]).toEqual(['2026-08-05T20:00:00.000Z', 25])

    expect(send).toHaveBeenCalledTimes(2)
  })

  it.each([0, -1, 1.5, 1001])('rejects invalid batch limit %s', async (limit) => {
    await expect(
      publishPendingOutbox(new FakeDatabase([]), { send: vi.fn() }, limit),
    ).rejects.toThrow('Outbox publication limit must be an integer between 1 and 1000.')
  })
})
