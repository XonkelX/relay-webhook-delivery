import { env } from 'cloudflare:workers'
import {
  OwnerEndpointSecretRotationResponseSchema,
  OwnerEndpointStatusUpdateResponseSchema,
  OwnerEndpointSubscriptionsUpdateResponseSchema,
  OwnerEndpointVerificationResponseSchema,
} from '@relay/contracts'
import { describe, expect, it, vi } from 'vitest'
import app from '../worker/index.js'
import { createEndpoint } from '../worker/lib/endpoint-persistence.js'
import {
  createOwnerCsrfToken,
  createSignedOwnerSessionCookieValue,
} from '../worker/lib/owner-session-http.js'
import { createOwnerSession } from '../worker/lib/owner-session.js'
import {
  TEST_ENDPOINT_CRYPTO_DEPENDENCIES,
  TEST_ENDPOINT_SECRET_KEYRING,
  TEST_ENDPOINT_SIGNING_SECRET,
} from './test-endpoint-secret.js'

const signingKey = btoa('m'.repeat(32))
let sessionSequence = 0

async function ownerAuth() {
  sessionSequence += 1

  const rawToken = `rly_owner_${`manage${sessionSequence}`.padEnd(64, 'm').slice(0, 64)}`

  await createOwnerSession(env.DB, 3600, {
    createId: () => `ses_ownermgmt${sessionSequence}`,
    createToken: () => rawToken,
  })

  const signed = await createSignedOwnerSessionCookieValue(rawToken, signingKey)

  const csrf = await createOwnerCsrfToken(rawToken, signingKey)

  return {
    cookie: `__Host-relay_owner=${signed}; ` + `__Host-relay_csrf=${csrf}`,
    csrf,
  }
}

async function seedEndpoint(suffix: string, status: 'pending' | 'active' = 'pending') {
  const endpoint = await createEndpoint(
    env.DB,
    {
      name: `Management ${suffix}`,
      url: `https://management-${suffix}.example.test/webhook`,
      eventTypes: ['invoice.created'],
    },
    {
      ...TEST_ENDPOINT_CRYPTO_DEPENDENCIES,
      createSigningSecret: () => TEST_ENDPOINT_SIGNING_SECRET,
      createId: (prefix) => `${prefix}_ownermgmt${suffix}`,
    },
  )

  if (status === 'active') {
    const verifiedAt = new Date().toISOString()

    await env.DB.prepare(
      `UPDATE endpoints
         SET status = 'active',
             verified_at = ?,
             updated_at = ?
         WHERE id = ?`,
    )
      .bind(verifiedAt, verifiedAt, endpoint.id)
      .run()
  }

  return endpoint
}

async function ownerRequest(
  path: string,
  auth: Awaited<ReturnType<typeof ownerAuth>>,
  init: RequestInit = {},
) {
  const headers = new Headers(init.headers)

  headers.set('Cookie', auth.cookie)
  headers.set('X-Relay-CSRF', auth.csrf)

  if (init.body) {
    headers.set('Content-Type', 'application/json')
  }

  return app.request(
    path,
    {
      ...init,
      headers,
    },
    {
      DB: env.DB,
      DELIVERY_QUEUE: {
        send: vi.fn().mockResolvedValue(undefined),
      },
      OWNER_SESSION_SIGNING_KEY: signingKey,
      ENDPOINT_SECRET_MASTER_KEY_V1: TEST_ENDPOINT_SECRET_KEYRING.v1,
    },
  )
}

describe('owner endpoint management routes', () => {
  it('pauses and resumes an active endpoint', async () => {
    const auth = await ownerAuth()
    const endpoint = await seedEndpoint('routestatus', 'active')

    const pausedResponse = await ownerRequest(`/api/owner/endpoints/${endpoint.id}/status`, auth, {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'paused',
      }),
    })

    expect(pausedResponse.status).toBe(200)

    expect(
      OwnerEndpointStatusUpdateResponseSchema.parse(await pausedResponse.json()),
    ).toMatchObject({
      endpointId: endpoint.id,
      status: 'paused',
      changed: true,
    })

    const resumedResponse = await ownerRequest(`/api/owner/endpoints/${endpoint.id}/status`, auth, {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'active',
      }),
    })

    expect(resumedResponse.status).toBe(200)

    expect(
      OwnerEndpointStatusUpdateResponseSchema.parse(await resumedResponse.json()),
    ).toMatchObject({
      endpointId: endpoint.id,
      status: 'active',
      changed: true,
    })
  })

  it('replaces endpoint subscriptions', async () => {
    const auth = await ownerAuth()
    const endpoint = await seedEndpoint('routesubscriptions', 'active')

    const response = await ownerRequest(`/api/owner/endpoints/${endpoint.id}/subscriptions`, auth, {
      method: 'PUT',
      body: JSON.stringify({
        eventTypes: ['invoice.failed', 'invoice.paid', 'invoice.failed'],
      }),
    })

    expect(response.status).toBe(200)

    expect(OwnerEndpointSubscriptionsUpdateResponseSchema.parse(await response.json())).toEqual({
      endpointId: endpoint.id,
      subscriptions: ['invoice.failed', 'invoice.paid'],
    })
  })

  it('verifies a pending endpoint through the signed challenge flow', async () => {
    const auth = await ownerAuth()
    const endpoint = await seedEndpoint('routeverify')

    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input)

      const body = (await request.clone().json()) as {
        data: {
          challenge: string
        }
      }

      expect(request.headers.get('webhook-signature')).toMatch(/^v1,/)

      return new Response(null, {
        status: 200,
        headers: {
          'X-Relay-Challenge': body.data.challenge,
        },
      })
    }) as typeof fetch

    vi.stubGlobal('fetch', fetcher)

    try {
      const response = await ownerRequest(`/api/owner/endpoints/${endpoint.id}/verify`, auth, {
        method: 'POST',
      })

      expect(response.status).toBe(200)

      expect(OwnerEndpointVerificationResponseSchema.parse(await response.json())).toMatchObject({
        endpointId: endpoint.id,
        status: 'active',
      })

      expect(fetcher).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('rotates the secret and reveals only the new generation', async () => {
    const auth = await ownerAuth()
    const endpoint = await seedEndpoint('routerotation', 'active')

    const response = await ownerRequest(`/api/owner/endpoints/${endpoint.id}/rotate-secret`, auth, {
      method: 'POST',
    })

    expect(response.status).toBe(200)

    const rotated = OwnerEndpointSecretRotationResponseSchema.parse(await response.json())

    expect(rotated).toMatchObject({
      endpointId: endpoint.id,
      generation: 2,
    })

    expect(rotated.signingSecret).toMatch(/^rly_whsec_[a-f0-9]{64}$/)

    expect(rotated.signingSecret).not.toBe(TEST_ENDPOINT_SIGNING_SECRET)

    const generations = await env.DB.prepare(
      `SELECT generation, state, valid_until
         FROM endpoint_signing_secrets
         WHERE endpoint_id = ?
         ORDER BY generation`,
    )
      .bind(endpoint.id)
      .all<{
        generation: number
        state: string
        valid_until: string | null
      }>()

    expect(generations.results).toHaveLength(2)

    expect(generations.results[0]).toMatchObject({
      generation: 1,
      state: 'previous',
    })

    expect(generations.results[0]?.valid_until).not.toBeNull()

    expect(generations.results[1]).toEqual({
      generation: 2,
      state: 'active',
      valid_until: null,
    })
  })
})
