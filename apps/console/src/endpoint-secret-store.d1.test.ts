import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { createEndpoint } from '../worker/lib/endpoint-persistence.js'
import { resolveEndpointSigningSecret } from '../worker/lib/endpoint-secret-store.js'

const rawSecret = `rly_whsec_${'a'.repeat(64)}`

const keyring = {
  v1: btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, index) => index + 10))),
}

describe('D1 endpoint signing secret storage', () => {
  it('creates an endpoint with exactly one encrypted active secret', async () => {
    const endpoint = await createEndpoint(
      env.DB,
      {
        name: 'Encrypted secret endpoint',
        url: 'https://secret-storage.example.test/webhook',
        eventTypes: [],
      },
      {
        endpointSecretKeyVersion: 'v1',
        endpointSecretKeyring: keyring,
        createSigningSecret: () => rawSecret,
        now: () => '2026-08-06T23:00:00.000Z',
        createId: (prefix) => `${prefix}_secret_store`,
      },
    )

    expect(endpoint.signingSecret).toBe(rawSecret)

    const rows = await env.DB.prepare(
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
      .all<{
        generation: number
        state: string
        key_version: string
        iv_base64: string
        ciphertext_base64: string
        valid_until: string | null
      }>()

    expect(rows.results).toHaveLength(1)

    const stored = rows.results[0]

    expect(stored).toBeDefined()
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

  it('does not persist the plaintext signing secret', async () => {
    const endpoint = await createEndpoint(
      env.DB,
      {
        name: 'Plaintext guard endpoint',
        url: 'https://plaintext-guard.example.test/webhook',
        eventTypes: [],
      },
      {
        endpointSecretKeyVersion: 'v1',
        endpointSecretKeyring: keyring,
        createSigningSecret: () => rawSecret,
        createId: (prefix) => `${prefix}_plaintext_guard`,
      },
    )

    const stored = await env.DB.prepare(
      `SELECT ciphertext_base64
         FROM endpoint_signing_secrets
         WHERE endpoint_id = ?`,
    )
      .bind(endpoint.id)
      .first<{
        ciphertext_base64: string
      }>()

    expect(stored?.ciphertext_base64).not.toContain(rawSecret)
  })

  it('fails closed when no endpoint secret exists', async () => {
    await expect(
      resolveEndpointSigningSecret(env.DB, 'ep_missing_secret', keyring),
    ).rejects.toThrow('Endpoint does not have an active signing secret.')
  })
})
