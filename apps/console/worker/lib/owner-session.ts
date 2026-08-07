import { sha256Hex } from './auth.js'
import type { RelayDatabase } from './database.js'
import type { RelayIdPrefix } from './ids.js'
import { createPrefixedId } from './ids.js'

const SESSION_NAMESPACE = 'rly_owner_'
const SESSION_SECRET_BYTES = 32
const DEFAULT_TTL_SECONDS = 60 * 60
const MAX_TTL_SECONDS = 8 * 60 * 60

interface OwnerSessionRow {
  id: string
  created_at: string
  expires_at: string
  last_seen_at: string | null
  revoked_at: string | null
}

export interface CreatedOwnerSession {
  id: string
  rawToken: string
  createdAt: string
  expiresAt: string
}

export interface AuthenticatedOwnerSession {
  id: string
  createdAt: string
  expiresAt: string
  lastSeenAt: string
}

export interface OwnerSessionDependencies {
  now?: () => string
  createId?: (prefix: RelayIdPrefix) => string
  createToken?: () => string
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function createRawSessionToken(): string {
  const secret = new Uint8Array(SESSION_SECRET_BYTES)
  crypto.getRandomValues(secret)

  return `${SESSION_NAMESPACE}${bytesToHex(secret)}`
}

function calculateExpiry(createdAt: string, ttlSeconds: number): string {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > MAX_TTL_SECONDS) {
    throw new TypeError('Session TTL must be an integer between 1 second and 8 hours.')
  }

  const createdTime = Date.parse(createdAt)

  if (!Number.isFinite(createdTime)) {
    throw new TypeError('Session creation time must be a valid ISO timestamp.')
  }

  return new Date(createdTime + ttlSeconds * 1000).toISOString()
}

export async function createOwnerSession(
  database: RelayDatabase,
  ttlSeconds = DEFAULT_TTL_SECONDS,
  dependencies: OwnerSessionDependencies = {},
): Promise<CreatedOwnerSession> {
  const now = dependencies.now ?? (() => new Date().toISOString())
  const createId = dependencies.createId ?? createPrefixedId
  const createToken = dependencies.createToken ?? createRawSessionToken
  const createdAt = now()
  const expiresAt = calculateExpiry(createdAt, ttlSeconds)
  const rawToken = createToken()
  const tokenHash = await sha256Hex(rawToken)
  const id = createId('ses')

  await database
    .prepare(
      `INSERT INTO owner_sessions (
         id,
         token_hash,
         created_at,
         expires_at
       )
       VALUES (?, ?, ?, ?)`,
    )
    .bind(id, tokenHash, createdAt, expiresAt)
    .run()

  return {
    id,
    rawToken,
    createdAt,
    expiresAt,
  }
}

export async function authenticateOwnerSession(
  database: RelayDatabase,
  rawToken: string,
  now = new Date().toISOString(),
): Promise<AuthenticatedOwnerSession | null> {
  if (!rawToken.startsWith(SESSION_NAMESPACE)) {
    return null
  }

  const tokenHash = await sha256Hex(rawToken)

  const session = await database
    .prepare(
      `SELECT
         id,
         created_at,
         expires_at,
         last_seen_at,
         revoked_at
       FROM owner_sessions
       WHERE token_hash = ?
       LIMIT 1`,
    )
    .bind(tokenHash)
    .first<OwnerSessionRow>()

  if (
    !session ||
    session.revoked_at !== null ||
    Date.parse(session.expires_at) <= Date.parse(now)
  ) {
    return null
  }

  await database
    .prepare(
      `UPDATE owner_sessions
       SET last_seen_at = ?
       WHERE id = ?
         AND revoked_at IS NULL`,
    )
    .bind(now, session.id)
    .run()

  return {
    id: session.id,
    createdAt: session.created_at,
    expiresAt: session.expires_at,
    lastSeenAt: now,
  }
}

export async function revokeOwnerSession(
  database: RelayDatabase,
  rawToken: string,
  revokedAt = new Date().toISOString(),
): Promise<void> {
  const tokenHash = await sha256Hex(rawToken)

  await database
    .prepare(
      `UPDATE owner_sessions
       SET revoked_at = ?
       WHERE token_hash = ?
         AND revoked_at IS NULL`,
    )
    .bind(revokedAt, tokenHash)
    .run()
}
