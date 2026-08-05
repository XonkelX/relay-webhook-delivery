import { describe, expect, it } from 'vitest'
import { createApiKey, type CreateApiKeyDependencies } from '../worker/lib/create-api-key.js'
import type { RelayDatabase, RelayStatement } from '../worker/lib/database.js'

class FakeStatement implements RelayStatement {
  values: unknown[] = []

  bind(...values: unknown[]): RelayStatement {
    this.values = values
    return this
  }

  async first<T>(): Promise<T | null> {
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
  statement = new FakeStatement()

  prepare(): RelayStatement {
    return this.statement
  }

  async batch(): Promise<unknown[]> {
    return []
  }
}

const dependencies: CreateApiKeyDependencies = {
  now: () => '2026-08-05T10:00:00.000Z',
  createId: () => 'key_integration',
  createMaterial: async () => ({
    rawKey: `rly_live_${'a'.repeat(64)}`,
    keyPrefix: 'rly_live_aaaaaaa',
    secretHash: 'b'.repeat(64),
  }),
}

describe('API-key persistence', () => {
  it('stores only hashed key material and returns the raw key once', async () => {
    const database = new FakeDatabase()

    const result = await createApiKey(database, '  Production  ', dependencies)

    expect(database.statement.values).toEqual([
      'key_integration',
      'Production',
      'rly_live_aaaaaaa',
      'b'.repeat(64),
      '2026-08-05T10:00:00.000Z',
    ])

    expect(database.statement.values).not.toContain(result.rawKey)

    expect(result).toEqual({
      id: 'key_integration',
      name: 'Production',
      keyPrefix: 'rly_live_aaaaaaa',
      rawKey: `rly_live_${'a'.repeat(64)}`,
      status: 'active',
      createdAt: '2026-08-05T10:00:00.000Z',
    })
  })

  it.each(['', '   ', 'a'.repeat(81)])('rejects invalid key name %j', async (name) => {
    await expect(createApiKey(new FakeDatabase(), name, dependencies)).rejects.toThrow(
      'API key name must contain between 1 and 80 characters.',
    )
  })
})
