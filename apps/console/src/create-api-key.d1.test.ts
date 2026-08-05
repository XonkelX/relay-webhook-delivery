import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { createApiKey } from '../worker/lib/create-api-key.js'

describe('D1 API-key persistence', () => {
  it('stores the hash but never the raw credential', async () => {
    const rawKey = `rly_live_${'c'.repeat(64)}`
    const secretHash = 'd'.repeat(64)

    const created = await createApiKey(env.DB, 'Integration key', {
      now: () => '2026-08-05T10:15:00.000Z',
      createId: () => 'key_d1_integration',
      createMaterial: async () => ({
        rawKey,
        keyPrefix: 'rly_live_ccccccc',
        secretHash,
      }),
    })

    const stored = await env.DB.prepare(
      `SELECT
           id,
           name,
           key_prefix,
           secret_hash,
           status,
           created_at
         FROM api_keys
         WHERE id = ?`,
    )
      .bind(created.id)
      .first<{
        id: string
        name: string
        key_prefix: string
        secret_hash: string
        status: string
        created_at: string
      }>()

    expect(created.rawKey).toBe(rawKey)

    expect(stored).toEqual({
      id: 'key_d1_integration',
      name: 'Integration key',
      key_prefix: 'rly_live_ccccccc',
      secret_hash: secretHash,
      status: 'active',
      created_at: '2026-08-05T10:15:00.000Z',
    })

    expect(JSON.stringify(stored)).not.toContain(rawKey)
  })
})
