import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { createEndpoint } from '../worker/lib/endpoint-persistence.js'
import {
  provisionEndpointSigningSecret,
  resolveEndpointSigningSecret,
} from '../worker/lib/endpoint-secret-store.js'

const rawSecret = `rly_whsec_${'a'.repeat(64)}`

const keyring = {
  v1: btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, index) => index + 10))),
}

describe('D1 endpoint signing secret storage', () => {
  it('stores only encrypted secret material and resolves the plaintext', async () => {
    const endpoint = await createEndpoint(
      env.DB,
      {
        name: 'Encrypted secret endpoint',
        url: 'https://secret-storage.example.test/webhook',
        eventTypes: [],
      },
      {
        now: () => '2026-08-06T23:00:00.000Z',
        createId: (prefix) => `${prefix}_secret_store`,
      },
    )

    await expect(
      provisionEndpointSigningSecret(env.DB, endpoint.id, 'v1', keyring, {
        now: () => '2026-08-06T23:01:00.000Z',
        createSecret: () => rawSecret,
      }),
    ).resolves.toEqual({
      endpointId: endpoint.id,
      rawSecret,
      generation: 1,
      keyVersion: 'v1',
      createdAt: '2026-08-06T23:01:00.000Z',
    })

    const stored = await env.DB.prepare(
      `SELECT
           generation,
           state,
           key_version,
           iv_base64,
           ciphertext_base64,
           valid_until
         FROM endpoint_signing_secrets
         WHERE endpoint_id = ?`,
    )
      .bind(endpoint.id)
      .first<{
        generation: number
        state: string
        key_version: string
        iv_base64: string
        ciphertext_base64: string
        valid_until: string | null
      }>()

    expect(stored).not.toBeNull()
    expect(stored?.generation).toBe(1)
    expect(stored?.state).toBe('active')
    expect(stored?.key_version).toBe('v1')
    expect(stored?.valid_until).toBeNull()
    expect(stored?.iv_base64).not.toContain(rawSecret)
    expect(stored?.ciphertext_base64).not.toContain(rawSecret)

    await expect(resolveEndpointSigningSecret(env.DB, endpoint.id, keyring)).resolves.toBe(
      rawSecret,
    )
  })

  it('rejects a second active secret provision', async () => {
    const endpoint = await createEndpoint(
      env.DB,
      {
        name: 'Duplicate secret endpoint',
        url: 'https://duplicate-secret.example.test/webhook',
        eventTypes: [],
      },
      {
        now: () => '2026-08-06T23:10:00.000Z',
        createId: (prefix) => `${prefix}_secret_duplicate`,
      },
    )

    await provisionEndpointSigningSecret(env.DB, endpoint.id, 'v1', keyring, {
      createSecret: () => rawSecret,
    })

    await expect(
      provisionEndpointSigningSecret(env.DB, endpoint.id, 'v1', keyring, {
        createSecret: () => `rly_whsec_${'b'.repeat(64)}`,
      }),
    ).rejects.toThrow('Endpoint already has an active signing secret.')
  })

  it('rejects secret operations for a missing endpoint', async () => {
    await expect(
      provisionEndpointSigningSecret(env.DB, 'ep_missing_secret', 'v1', keyring),
    ).rejects.toThrow('Endpoint does not exist.')

    await expect(
      resolveEndpointSigningSecret(env.DB, 'ep_missing_secret', keyring),
    ).rejects.toThrow('Endpoint does not have an active signing secret.')
  })
})
