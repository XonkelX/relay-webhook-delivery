import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { sha256Hex } from '../worker/lib/auth.js'
import {
  authenticateOwnerSession,
  createOwnerSession,
  revokeOwnerSession,
} from '../worker/lib/owner-session.js'

describe('D1 owner sessions', () => {
  it('stores only a token hash and supports expiry and revocation', async () => {
    const rawToken = `rly_owner_${'a'.repeat(64)}`

    const created = await createOwnerSession(env.DB, 3600, {
      now: () => '2026-08-05T15:00:00.000Z',
      createId: () => 'ses_d1_integration',
      createToken: () => rawToken,
    })

    expect(created).toEqual({
      id: 'ses_d1_integration',
      rawToken,
      createdAt: '2026-08-05T15:00:00.000Z',
      expiresAt: '2026-08-05T16:00:00.000Z',
    })

    const stored = await env.DB.prepare(
      `SELECT
           id,
           token_hash,
           created_at,
           expires_at,
           last_seen_at,
           revoked_at
         FROM owner_sessions
         WHERE id = ?`,
    )
      .bind(created.id)
      .first<{
        id: string
        token_hash: string
        created_at: string
        expires_at: string
        last_seen_at: string | null
        revoked_at: string | null
      }>()

    expect(stored?.token_hash).toBe(await sha256Hex(rawToken))
    expect(JSON.stringify(stored)).not.toContain(rawToken)

    await expect(
      authenticateOwnerSession(env.DB, rawToken, '2026-08-05T15:15:00.000Z'),
    ).resolves.toEqual({
      id: 'ses_d1_integration',
      createdAt: '2026-08-05T15:00:00.000Z',
      expiresAt: '2026-08-05T16:00:00.000Z',
      lastSeenAt: '2026-08-05T15:15:00.000Z',
    })

    await expect(
      authenticateOwnerSession(env.DB, rawToken, '2026-08-05T16:00:00.000Z'),
    ).resolves.toBeNull()

    await revokeOwnerSession(env.DB, rawToken, '2026-08-05T15:30:00.000Z')

    await expect(
      authenticateOwnerSession(env.DB, rawToken, '2026-08-05T15:31:00.000Z'),
    ).resolves.toBeNull()
  })

  it('rejects invalid session TTL values', async () => {
    await expect(createOwnerSession(env.DB, 0)).rejects.toThrow(
      'Session TTL must be an integer between 1 second and 30 days.',
    )
  })
})
