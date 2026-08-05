import { describe, expect, it, vi } from 'vitest'
import { authenticateApiKey, type ApiKeyDatabase } from '../worker/lib/api-key-auth.js'
import { sha256Hex } from '../worker/lib/auth.js'

interface FakeRow {
  id: string
  name: string
  key_prefix: string
  status: 'active' | 'revoked'
}

function createDatabase(
  row: FakeRow | null,
  options: {
    failLookup?: boolean
  } = {},
) {
  const updateRun = vi.fn().mockResolvedValue({ success: true })

  const database: ApiKeyDatabase = {
    prepare(query: string) {
      if (query.includes('SELECT id, name, key_prefix, status')) {
        return {
          bind() {
            return {
              first: async <T>() => {
                if (options.failLookup) {
                  throw new Error('database unavailable')
                }

                return row as T | null
              },
              run: async () => ({ success: true }),
            }
          },
        }
      }

      if (query.includes('UPDATE api_keys')) {
        return {
          bind() {
            return {
              first: async <T>() => null as T | null,
              run: updateRun,
            }
          },
        }
      }

      throw new Error(`Unexpected query: ${query}`)
    },
  }

  return {
    database,
    updateRun,
  }
}

describe('API-key authentication', () => {
  it('distinguishes missing credentials', async () => {
    const { database } = createDatabase(null)

    await expect(authenticateApiKey(null, database)).resolves.toEqual({
      ok: false,
      reason: 'missing',
    })
  })

  it.each(['Basic credentials', 'Bearer', 'Bearer invalid', 'Bearer rly_live_NOT_HEX'])(
    'rejects malformed credentials: %s',
    async (authorization) => {
      const { database } = createDatabase(null)

      await expect(authenticateApiKey(authorization, database)).resolves.toEqual({
        ok: false,
        reason: 'malformed',
      })
    },
  )

  it('rejects an unknown valid-looking key', async () => {
    const { database } = createDatabase(null)
    const rawKey = `rly_live_${'a'.repeat(64)}`

    await expect(authenticateApiKey(`Bearer ${rawKey}`, database)).resolves.toEqual({
      ok: false,
      reason: 'unknown',
    })
  })

  it('rejects a revoked key without updating usage', async () => {
    const { database, updateRun } = createDatabase({
      id: 'key_123',
      name: 'Revoked key',
      key_prefix: 'rly_live_aaaaaaa',
      status: 'revoked',
    })

    await expect(
      authenticateApiKey(`Bearer rly_live_${'a'.repeat(64)}`, database),
    ).resolves.toEqual({
      ok: false,
      reason: 'revoked',
    })

    expect(updateRun).not.toHaveBeenCalled()
  })

  it('returns an active key and records last usage', async () => {
    const usedAt = '2026-08-05T08:00:00.000Z'
    const rawKey = `rly_live_${'b'.repeat(64)}`
    const secretHash = await sha256Hex(rawKey)

    expect(secretHash).toMatch(/^[a-f0-9]{64}$/)

    const { database, updateRun } = createDatabase({
      id: 'key_123',
      name: 'Production',
      key_prefix: rawKey.slice(0, 16),
      status: 'active',
    })

    await expect(authenticateApiKey(`Bearer ${rawKey}`, database, usedAt)).resolves.toEqual({
      ok: true,
      apiKey: {
        id: 'key_123',
        name: 'Production',
        keyPrefix: rawKey.slice(0, 16),
      },
    })

    expect(updateRun).toHaveBeenCalledOnce()
  })

  it('propagates database failures', async () => {
    const { database } = createDatabase(null, {
      failLookup: true,
    })

    await expect(authenticateApiKey(`Bearer rly_live_${'c'.repeat(64)}`, database)).rejects.toThrow(
      'database unavailable',
    )
  })
})
