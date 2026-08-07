import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { createEndpoint } from '../worker/lib/endpoint-persistence.js'
import {
  provisionEndpointSigningSecret,
  resolveEndpointSigningSecrets,
  rotateEndpointSigningSecret,
} from '../worker/lib/endpoint-secret-store.js'

const secretA = `rly_whsec_${'a'.repeat(64)}`
const secretB = `rly_whsec_${'b'.repeat(64)}`
const secretC = `rly_whsec_${'c'.repeat(64)}`

const keyring = {
  v1: btoa('k'.repeat(32)),
  v2: btoa('m'.repeat(32)),
}

async function seedEndpoint(suffix: string) {
  return createEndpoint(
    env.DB,
    {
      name: `Rotation ${suffix}`,
      url: `https://rotation-${suffix}.example.test/webhook`,
      eventTypes: [],
    },
    {
      createId: (prefix) => `${prefix}_rotation_${suffix}`,
    },
  )
}

describe('D1 endpoint signing secret rotation', () => {
  it('returns active then previous during the grace window', async () => {
    const endpoint = await seedEndpoint('grace')

    await provisionEndpointSigningSecret(env.DB, endpoint.id, 'v1', keyring, {
      createSecret: () => secretA,
    })

    const rotated = await rotateEndpointSigningSecret(env.DB, endpoint.id, 'v2', keyring, {
      nowMilliseconds: () => Date.parse('2026-08-07T02:00:00.000Z'),
      graceSeconds: 3600,
      createSecret: () => secretB,
    })

    expect(rotated).toMatchObject({
      rawSecret: secretB,
      generation: 2,
      keyVersion: 'v2',
      previousValidUntil: '2026-08-07T03:00:00.000Z',
    })

    await expect(
      resolveEndpointSigningSecrets(
        env.DB,
        endpoint.id,
        keyring,
        Date.parse('2026-08-07T02:30:00.000Z'),
      ),
    ).resolves.toEqual([secretB, secretA])
  })

  it('uses only the active secret after grace expires', async () => {
    const endpoint = await seedEndpoint('expired')

    await provisionEndpointSigningSecret(env.DB, endpoint.id, 'v1', keyring, {
      createSecret: () => secretA,
    })

    await rotateEndpointSigningSecret(env.DB, endpoint.id, 'v1', keyring, {
      nowMilliseconds: () => Date.parse('2026-08-07T04:00:00.000Z'),
      graceSeconds: 60,
      createSecret: () => secretB,
    })

    await expect(
      resolveEndpointSigningSecrets(
        env.DB,
        endpoint.id,
        keyring,
        Date.parse('2026-08-07T04:01:01.000Z'),
      ),
    ).resolves.toEqual([secretB])
  })

  it('retains only the immediately previous generation', async () => {
    const endpoint = await seedEndpoint('second')

    await provisionEndpointSigningSecret(env.DB, endpoint.id, 'v1', keyring, {
      createSecret: () => secretA,
    })

    await rotateEndpointSigningSecret(env.DB, endpoint.id, 'v1', keyring, {
      nowMilliseconds: () => Date.parse('2026-08-07T05:00:00.000Z'),
      createSecret: () => secretB,
    })

    await rotateEndpointSigningSecret(env.DB, endpoint.id, 'v2', keyring, {
      nowMilliseconds: () => Date.parse('2026-08-07T05:10:00.000Z'),
      createSecret: () => secretC,
    })

    await expect(
      resolveEndpointSigningSecrets(
        env.DB,
        endpoint.id,
        keyring,
        Date.parse('2026-08-07T05:20:00.000Z'),
      ),
    ).resolves.toEqual([secretC, secretB])

    const rows = await env.DB.prepare(
      `SELECT generation, state
         FROM endpoint_signing_secrets
         WHERE endpoint_id = ?
         ORDER BY generation`,
    )
      .bind(endpoint.id)
      .all<{
        generation: number
        state: string
      }>()

    expect(rows.results).toEqual([
      {
        generation: 2,
        state: 'previous',
      },
      {
        generation: 3,
        state: 'active',
      },
    ])
  })

  it('rejects an unbounded grace window', async () => {
    const endpoint = await seedEndpoint('bounded')

    await provisionEndpointSigningSecret(env.DB, endpoint.id, 'v1', keyring, {
      createSecret: () => secretA,
    })

    await expect(
      rotateEndpointSigningSecret(env.DB, endpoint.id, 'v1', keyring, {
        graceSeconds: 86_401,
        createSecret: () => secretB,
      }),
    ).rejects.toThrow('Secret rotation grace must be an integer between 1 and 86400 seconds.')
  })
})
