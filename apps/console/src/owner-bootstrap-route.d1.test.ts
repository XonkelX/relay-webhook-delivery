import { env } from 'cloudflare:workers'
import { OwnerSessionBootstrapResponseSchema } from '@relay/contracts'
import { describe, expect, it, vi } from 'vitest'
import app from '../worker/index.js'

const signingKey = btoa('b'.repeat(32))
const bootstrapToken = 'relay-owner-bootstrap-token'.padEnd(40, 'x')

const queue = {
  send: vi.fn().mockResolvedValue(undefined),
}

function requestBootstrap(
  body: unknown,
  bindings: {
    OWNER_BOOTSTRAP_TOKEN?: string
    OWNER_SESSION_SIGNING_KEY?: string
  } = {
    OWNER_BOOTSTRAP_TOKEN: bootstrapToken,
    OWNER_SESSION_SIGNING_KEY: signingKey,
  },
) {
  return app.request(
    '/api/owner/session',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    {
      DB: env.DB,
      DELIVERY_QUEUE: queue,
      ...bindings,
    },
  )
}

function readIssuedCookie(setCookie: string, name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')

  const match = setCookie.match(new RegExp(`${escapedName}=([^;,]+)`, 'u'))

  if (!match?.[1]) {
    throw new Error(`Expected ${name} in Set-Cookie header.`)
  }

  return match[1]
}

async function login() {
  const response = await requestBootstrap({
    token: bootstrapToken,
  })

  expect(response.status).toBe(201)

  const body = OwnerSessionBootstrapResponseSchema.parse(await response.json())

  const setCookie = response.headers.get('set-cookie')

  expect(setCookie).not.toBeNull()

  return {
    body,
    setCookie: setCookie!,
    sessionCookie: readIssuedCookie(setCookie!, '__Host-relay_owner'),
    csrfCookie: readIssuedCookie(setCookie!, '__Host-relay_csrf'),
  }
}

describe('POST /api/owner/session', () => {
  it('creates a signed owner session and grants authenticated access', async () => {
    const result = await login()

    expect(result.body.status).toBe('authenticated')
    expect(Date.parse(result.body.expiresAt)).toBeGreaterThan(Date.now())

    expect(result.setCookie).toContain('__Host-relay_owner=')
    expect(result.setCookie).toContain('__Host-relay_csrf=')
    expect(result.setCookie).toContain('HttpOnly')
    expect(result.setCookie).toContain('Secure')
    expect(result.setCookie).toContain('SameSite=Strict')

    expect(result.setCookie).not.toContain(bootstrapToken)

    const authenticated = await app.request(
      '/api/owner/events?limit=1',
      {
        headers: {
          Cookie:
            `__Host-relay_owner=${result.sessionCookie}; ` +
            `__Host-relay_csrf=${result.csrfCookie}`,
        },
      },
      {
        DB: env.DB,
        DELIVERY_QUEUE: queue,
        OWNER_SESSION_SIGNING_KEY: signingKey,
        OWNER_BOOTSTRAP_TOKEN: bootstrapToken,
      },
    )

    expect(authenticated.status).toBe(200)
  })

  it('returns a generic 401 for invalid credentials without creating a session', async () => {
    const before = await env.DB.prepare(
      `SELECT COUNT(*) AS count
         FROM owner_sessions`,
    ).first<{ count: number }>()

    const response = await requestBootstrap({
      token: 'incorrect-owner-token',
    })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      error: {
        code: 'UNAUTHORIZED',
        message: 'The owner credentials are invalid.',
      },
    })

    expect(response.headers.get('set-cookie')).toBeNull()

    const after = await env.DB.prepare(
      `SELECT COUNT(*) AS count
         FROM owner_sessions`,
    ).first<{ count: number }>()

    expect(after?.count).toBe(before?.count)
  })

  it('does not distinguish malformed credentials from invalid credentials', async () => {
    const response = await requestBootstrap({
      wrongField: bootstrapToken,
    })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      error: {
        code: 'UNAUTHORIZED',
        message: 'The owner credentials are invalid.',
      },
    })
  })

  it('fails closed when owner authentication configuration is missing or invalid', async () => {
    const missing = await requestBootstrap(
      {
        token: bootstrapToken,
      },
      {
        OWNER_SESSION_SIGNING_KEY: signingKey,
      },
    )

    expect(missing.status).toBe(500)
    expect(await missing.json()).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Owner authentication is unavailable.',
      },
    })

    const invalid = await requestBootstrap(
      {
        token: bootstrapToken,
      },
      {
        OWNER_BOOTSTRAP_TOKEN: 'too-short',
        OWNER_SESSION_SIGNING_KEY: signingKey,
      },
    )

    expect(invalid.status).toBe(500)
    expect(await invalid.json()).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Owner authentication is unavailable.',
      },
    })
  })

  it('issues cookies compatible with CSRF-protected logout and revocation', async () => {
    const result = await login()

    const cookie =
      `__Host-relay_owner=${result.sessionCookie}; ` + `__Host-relay_csrf=${result.csrfCookie}`

    const logout = await app.request(
      '/api/owner/logout',
      {
        method: 'POST',
        headers: {
          Cookie: cookie,
          'X-Relay-CSRF': result.csrfCookie,
        },
      },
      {
        DB: env.DB,
        DELIVERY_QUEUE: queue,
        OWNER_SESSION_SIGNING_KEY: signingKey,
        OWNER_BOOTSTRAP_TOKEN: bootstrapToken,
      },
    )

    expect(logout.status).toBe(204)
    expect(logout.headers.get('set-cookie')).toContain('Max-Age=0')

    const afterLogout = await app.request(
      '/api/owner/events?limit=1',
      {
        headers: {
          Cookie: cookie,
        },
      },
      {
        DB: env.DB,
        DELIVERY_QUEUE: queue,
        OWNER_SESSION_SIGNING_KEY: signingKey,
        OWNER_BOOTSTRAP_TOKEN: bootstrapToken,
      },
    )

    expect(afterLogout.status).toBe(401)
  })
})
