import { env } from 'cloudflare:workers'
import { describe, expect, it, vi } from 'vitest'
import { createEndpoint } from '../worker/lib/endpoint-persistence.js'
import { verifyEndpoint } from '../worker/lib/endpoint-verification.js'

const now = Date.parse('2026-08-06T22:00:00.000Z')

async function seedEndpoint(suffix: string): Promise<string> {
  const endpoint = await createEndpoint(
    env.DB,
    {
      name: `Verification ${suffix}`,
      url: `https://${suffix}.example.test/webhook`,
      eventTypes: [],
    },
    {
      now: () => '2026-08-06T21:55:00.000Z',
      createId: (prefix) => `${prefix}_verify_${suffix}`,
    },
  )

  return endpoint.id
}

describe('D1 endpoint verification', () => {
  it('activates only after an exact signed challenge response', async () => {
    const endpointId = await seedEndpoint('success')
    const challenge = 'rly_verify_success_challenge'

    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input)

      expect(request.redirect).toBe('manual')
      expect(request.headers.get('webhook-signature')).toMatch(/^v1,/)

      const body = (await request.clone().json()) as {
        type: string
        data: {
          challenge: string
        }
      }

      expect(body.type).toBe('relay.endpoint_verification')
      expect(body.data.challenge).toBe(challenge)

      return new Response(null, {
        status: 200,
        headers: {
          'X-Relay-Challenge': body.data.challenge,
        },
      })
    }) as typeof fetch

    await expect(
      verifyEndpoint(env.DB, endpointId, 'endpoint_test_secret', {
        createChallenge: () => challenge,
        fetcher,
        nowMilliseconds: () => now,
      }),
    ).resolves.toEqual({
      kind: 'verified',
      endpointId,
      verifiedAt: '2026-08-06T22:00:00.000Z',
    })

    const stored = await env.DB.prepare(
      `SELECT
           status,
           verified_at,
           verification_challenge_hash,
           verification_expires_at
         FROM endpoints
         WHERE id = ?`,
    )
      .bind(endpointId)
      .first<{
        status: string
        verified_at: string | null
        verification_challenge_hash: string | null
        verification_expires_at: string | null
      }>()

    expect(stored).toEqual({
      status: 'active',
      verified_at: '2026-08-06T22:00:00.000Z',
      verification_challenge_hash: null,
      verification_expires_at: null,
    })
  })

  it('keeps the endpoint pending when the challenge does not match', async () => {
    const endpointId = await seedEndpoint('wrong')

    const fetcher = vi.fn(
      async () =>
        new Response(null, {
          status: 200,
          headers: {
            'X-Relay-Challenge': 'wrong',
          },
        }),
    ) as typeof fetch

    await expect(
      verifyEndpoint(env.DB, endpointId, 'endpoint_test_secret', {
        createChallenge: () => 'rly_verify_expected',
        fetcher,
        nowMilliseconds: () => now,
      }),
    ).resolves.toMatchObject({
      kind: 'failed',
      reason: 'challenge_mismatch',
    })

    const stored = await env.DB.prepare(
      `SELECT
           status,
           verified_at,
           verification_challenge_hash
         FROM endpoints
         WHERE id = ?`,
    )
      .bind(endpointId)
      .first<{
        status: string
        verified_at: string | null
        verification_challenge_hash: string | null
      }>()

    expect(stored).toEqual({
      status: 'pending',
      verified_at: null,
      verification_challenge_hash: null,
    })
  })

  it('does not follow redirects during verification', async () => {
    const endpointId = await seedEndpoint('redirect')
    const challenge = 'rly_verify_redirect'

    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input)

      expect(request.redirect).toBe('manual')

      return new Response(null, {
        status: 302,
        headers: {
          location: 'https://other.example.test/',
          'X-Relay-Challenge': challenge,
        },
      })
    }) as typeof fetch

    await expect(
      verifyEndpoint(env.DB, endpointId, 'endpoint_test_secret', {
        createChallenge: () => challenge,
        fetcher,
        nowMilliseconds: () => now,
      }),
    ).resolves.toMatchObject({
      kind: 'failed',
      reason: 'http_status',
      statusCode: 302,
    })
  })
})
