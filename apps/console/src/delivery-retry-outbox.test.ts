import { describe, expect, it } from 'vitest'
import { completeDeliveryAttempt } from '../worker/lib/delivery-attempt.js'
import type { RelayDatabase, RelayStatement } from '../worker/lib/database.js'

class FakeStatement implements RelayStatement {
  readonly query: string
  values: unknown[] = []

  constructor(query: string) {
    this.query = query
  }

  bind(...values: unknown[]): RelayStatement {
    this.values = values
    return this
  }

  async first<T>(): Promise<T | null> {
    if (this.query.includes('FROM delivery_attempts')) {
      return {
        state: 'completed',
        outcome: 'transient_failure',
        completed_at: '2026-08-05T22:00:01.000Z',
        lease_token: 'lease_retry',
      } as T
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
  batched: FakeStatement[] = []

  prepare(query: string): RelayStatement {
    return new FakeStatement(query)
  }

  async batch(statements: RelayStatement[]): Promise<unknown[]> {
    this.batched = statements as FakeStatement[]
    return statements.map(() => ({ success: true }))
  }
}

describe('delivery retry scheduling', () => {
  it('rearms the durable outbox in the completion batch', async () => {
    const database = new FakeDatabase()

    await expect(
      completeDeliveryAttempt(database, {
        deliveryId: 'dlv_retry',
        attemptNo: 1,
        leaseToken: 'lease_retry',
        outcome: 'transient_failure',
        completedAt: '2026-08-05T22:00:01.000Z',
        retryAt: '2026-08-05T22:01:00.000Z',
        statusCode: 503,
        latencyMs: 1000,
      }),
    ).resolves.toBe(true)

    expect(database.batched).toHaveLength(3)

    const outboxUpdate = database.batched[2]

    expect(outboxUpdate?.query).toContain('UPDATE delivery_outbox')
    expect(outboxUpdate?.query).toContain("reason = 'retry'")
    expect(outboxUpdate?.values).toEqual(['2026-08-05T22:01:00.000Z', 'dlv_retry'])
  })
})
