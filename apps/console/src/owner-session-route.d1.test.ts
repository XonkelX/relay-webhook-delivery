import { env } from 'cloudflare:workers'
import { describe, expect, it, vi } from 'vitest'
import app from '../worker/index.js'
import {
  createOwnerCsrfToken,
  createSignedOwnerSessionCookieValue,
} from '../worker/lib/owner-session-http.js'
import { authenticateOwnerSession, createOwnerSession } from '../worker/lib/owner-session.js'

const signingKey = btoa('o'.repeat(32))

async function createSession(suffix: string, tokenCharacter: string) {
  const rawToken = `rly_owner_${tokenCharacter.repeat(64)}`

  const created = await createOwnerSession(env.DB, 3600, {
    createId: () => `ses_http_${suffix}`,
    createToken: () => rawToken,
  })

  const signedCookie = await createSignedOwnerSessionCookieValue(rawToken, signingKey)

  const csrf = await createOwnerCsrfToken(rawToken, signingKey)

  return {
    ...created,
    rawToken,
    signedCookie,
    csrf,
  }
}

function requestLogout(cookie: string, csrf?: string) {
  const headers = new Headers({
    Cookie: cookie,
  })

  if (csrf) {
    headers.set('X-Relay-CSRF', csrf)
  }

  return app.request(
    '/api/owner/logout',
    {
      method: 'POST',
      headers,
    },
    {
      DB: env.DB,
      DELIVERY_QUEUE: {
        send: vi.fn().mockResolvedValue(undefined),
      },
      OWNER_SESSION_SIGNING_KEY: signingKey,
    },
  )
}

describe('POST /api/owner/logout', () => {
  it('revokes the session and expires owner cookies', async () => {
    const session = await createSession('logout', 'a')

    const response = await requestLogout(
      `__Host-relay_owner=${session.signedCookie}; __Host-relay_csrf=${session.csrf}`,
      session.csrf,
    )

    expect(response.status).toBe(204)
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
    expect(response.headers.get('set-cookie')).toContain('SameSite=Strict')

    await expect(authenticateOwnerSession(env.DB, session.rawToken)).resolves.toBeNull()
  })

  it('rejects state-changing owner requests without CSRF', async () => {
    const session = await createSession('csrf', 'b')

    const response = await requestLogout(
      `__Host-relay_owner=${session.signedCookie}; __Host-relay_csrf=${session.csrf}`,
    )

    expect(response.status).toBe(403)

    await expect(authenticateOwnerSession(env.DB, session.rawToken)).resolves.not.toBeNull()
  })

  it('rejects tampered signed session cookies', async () => {
    const session = await createSession('tampered', 'c')

    const response = await requestLogout(
      `__Host-relay_owner=${session.signedCookie}x; __Host-relay_csrf=${session.csrf}`,
      session.csrf,
    )

    expect(response.status).toBe(401)

    await expect(authenticateOwnerSession(env.DB, session.rawToken)).resolves.not.toBeNull()
  })
})
