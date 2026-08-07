const SESSION_COOKIE_NAME = '__Host-relay_owner'
const CSRF_COOKIE_NAME = '__Host-relay_csrf'

const COOKIE_VERSION = 'v1'
const MIN_SIGNING_KEY_BYTES = 32

const encoder = new TextEncoder()

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

function decodeSigningKey(signingKeyBase64: string): Uint8Array<ArrayBuffer> {
  let binary: string

  try {
    binary = atob(signingKeyBase64)
  } catch {
    throw new TypeError('Owner session signing key must be valid base64.')
  }

  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  if (bytes.byteLength < MIN_SIGNING_KEY_BYTES) {
    throw new TypeError('Owner session signing key must contain at least 32 bytes.')
  }

  return bytes
}

async function createHmac(value: string, signingKeyBase64: string): Promise<string> {
  const keyBytes = decodeSigningKey(signingKeyBase64)

  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    {
      name: 'HMAC',
      hash: 'SHA-256',
    },
    false,
    ['sign'],
  )

  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value))

  return bytesToBase64Url(new Uint8Array(signature))
}

function constantTimeEqual(left: string, right: string): boolean {
  const maximumLength = Math.max(left.length, right.length)

  let difference = left.length ^ right.length

  for (let index = 0; index < maximumLength; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0)
  }

  return difference === 0
}

function parseCookies(cookieHeader: string | null): ReadonlyMap<string, string> {
  const cookies = new Map<string, string>()

  if (!cookieHeader) {
    return cookies
  }

  for (const pair of cookieHeader.split(';')) {
    const separator = pair.indexOf('=')

    if (separator < 1) {
      continue
    }

    const name = pair.slice(0, separator).trim()
    const value = pair.slice(separator + 1).trim()

    cookies.set(name, value)
  }

  return cookies
}

export async function createSignedOwnerSessionCookieValue(
  rawToken: string,
  signingKeyBase64: string,
): Promise<string> {
  const signature = await createHmac(
    `relay:owner-session:${COOKIE_VERSION}:${rawToken}`,
    signingKeyBase64,
  )

  return `${COOKIE_VERSION}.${rawToken}.${signature}`
}

export async function verifySignedOwnerSessionCookieValue(
  cookieValue: string,
  signingKeyBase64: string,
): Promise<string | null> {
  const firstSeparator = cookieValue.indexOf('.')
  const lastSeparator = cookieValue.lastIndexOf('.')

  if (firstSeparator <= 0 || lastSeparator <= firstSeparator) {
    return null
  }

  const version = cookieValue.slice(0, firstSeparator)
  const rawToken = cookieValue.slice(firstSeparator + 1, lastSeparator)
  const signature = cookieValue.slice(lastSeparator + 1)

  if (version !== COOKIE_VERSION || !rawToken.startsWith('rly_owner_') || !signature) {
    return null
  }

  const expected = await createHmac(
    `relay:owner-session:${COOKIE_VERSION}:${rawToken}`,
    signingKeyBase64,
  )

  return constantTimeEqual(signature, expected) ? rawToken : null
}

export async function createOwnerCsrfToken(
  rawToken: string,
  signingKeyBase64: string,
): Promise<string> {
  return createHmac(`relay:owner-csrf:${COOKIE_VERSION}:${rawToken}`, signingKeyBase64)
}

export async function verifyOwnerCsrfToken(
  rawToken: string,
  submittedToken: string | null,
  cookieToken: string | null,
  signingKeyBase64: string,
): Promise<boolean> {
  if (!submittedToken || !cookieToken || !constantTimeEqual(submittedToken, cookieToken)) {
    return false
  }

  const expected = await createOwnerCsrfToken(rawToken, signingKeyBase64)

  return constantTimeEqual(submittedToken, expected)
}

export function readOwnerSessionCookie(cookieHeader: string | null): string | null {
  return parseCookies(cookieHeader).get(SESSION_COOKIE_NAME) ?? null
}

export function readOwnerCsrfCookie(cookieHeader: string | null): string | null {
  return parseCookies(cookieHeader).get(CSRF_COOKIE_NAME) ?? null
}

export function buildOwnerSessionCookie(value: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE_NAME}=${value}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Strict`
}

export function buildOwnerCsrfCookie(value: string, maxAgeSeconds: number): string {
  return `${CSRF_COOKIE_NAME}=${value}; Path=/; Max-Age=${maxAgeSeconds}; Secure; SameSite=Strict`
}

export function buildExpiredOwnerCookies(): [string, string] {
  return [
    `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`,
    `${CSRF_COOKIE_NAME}=; Path=/; Max-Age=0; Secure; SameSite=Strict`,
  ]
}
