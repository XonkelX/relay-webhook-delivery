import { describe, expect, it } from 'vitest'
import worker from '../worker/index.js'
import type { RelayDatabase, RelayStatement } from '../worker/lib/database.js'

class EmptyStatement implements RelayStatement {
  bind(...values: unknown[]): RelayStatement {
    void values
    return this
  }

  async first<T>(): Promise<T | null> {
    return null
  }

  async all<T>(): Promise<{ results: T[] }> {
    return {
      results: [],
    }
  }

  async run(): Promise<unknown> {
    return {
      success: true,
    }
  }
}

class EmptyDatabase implements RelayDatabase {
  prepare(query: string): RelayStatement {
    void query
    return new EmptyStatement()
  }

  async batch(statements: RelayStatement[]): Promise<unknown[]> {
    void statements
    void statements
    return []
  }
}

describe('scheduled outbox recovery', () => {
  it('runs the pending-outbox sweep through waitUntil', async () => {
    let pending: Promise<unknown> | undefined

    const context = {
      waitUntil(promise: Promise<unknown>) {
        pending = promise
      },
    } as ExecutionContext

    worker.scheduled(
      {
        scheduledTime: Date.parse('2026-08-05T20:00:00.000Z'),
        cron: '* * * * *',
      } as ScheduledController,
      {
        DB: new EmptyDatabase(),
        DELIVERY_QUEUE: {
          async send() {
            return undefined
          },
        },
      },
      context,
    )

    expect(pending).toBeDefined()
    await expect(pending).resolves.toBeUndefined()
  })
})
