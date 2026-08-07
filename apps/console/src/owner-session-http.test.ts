import { describe, expect, it } from 'vitest'
import {
  buildExpiredOwnerCookies,
  buildOwnerCsrfCookie,
  buildOwnerSessionCookie,
  createOwnerCsrfToken,
  createSignedOwnerSessionCookieValue,
  readOwnerCsrfCookie,
  readOwnerSessionCookie,
  verifyOwnerCsrfToken,
  verifySignedOwnerSessionCookieValue,
} from '../worker/lib/owner-session-http.js'

const signingKey = btoa('s'.repeat(32))
const rawToken = `rly_owner_${'a'.repeat(64)}`

describe('owner session HTTP security', () => {
  it('signs and verifies owner session cookie values', async () => {
    const value = await createSignedOwnerSessionCookieValue(rawToken, signingKey)

    await expect(verifySignedOwnerSessionCookieValue(value, signingKey)).resolves.toBe(rawToken)

    await expect(
      verifySignedOwnerSessionCookieValue(`${value}tampered`, signingKey),
    ).resolves.toBeNull()
  })

  it('derives and validates double-submit CSRF tokens', async () => {
    const csrf = await createOwnerCsrfToken(rawToken, signingKey)

    await expect(verifyOwnerCsrfToken(rawToken, csrf, csrf, signingKey)).resolves.toBe(true)

    await expect(verifyOwnerCsrfToken(rawToken, 'wrong', csrf, signingKey)).resolves.toBe(false)

    await expect(verifyOwnerCsrfToken(rawToken, csrf, null, signingKey)).resolves.toBe(false)
  })

  it('uses hardened Strict cookies', () => {
    const sessionCookie = buildOwnerSessionCookie('signed', 3600)

    expect(sessionCookie).toContain('HttpOnly')
    expect(sessionCookie).toContain('Secure')
    expect(sessionCookie).toContain('SameSite=Strict')
    expect(sessionCookie).toContain('Path=/')

    const csrfCookie = buildOwnerCsrfCookie('csrf', 3600)

    expect(csrfCookie).not.toContain('HttpOnly')
    expect(csrfCookie).toContain('Secure')
    expect(csrfCookie).toContain('SameSite=Strict')
  })

  it('reads owner cookies and creates deletion cookies', () => {
    const header = '__Host-relay_owner=signed; other=x; __Host-relay_csrf=csrf'

    expect(readOwnerSessionCookie(header)).toBe('signed')
    expect(readOwnerCsrfCookie(header)).toBe('csrf')

    const expired = buildExpiredOwnerCookies()

    expect(expired).toHaveLength(2)
    expect(expired[0]).toContain('Max-Age=0')
    expect(expired[1]).toContain('Max-Age=0')
  })

  it('rejects weak signing keys', async () => {
    await expect(createSignedOwnerSessionCookieValue(rawToken, btoa('short'))).rejects.toThrow(
      'Owner session signing key must contain at least 32 bytes.',
    )
  })
})
