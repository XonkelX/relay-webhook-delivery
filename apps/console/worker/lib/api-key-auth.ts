import { parseBearerToken, sha256Hex } from './auth.js'

const API_KEY_FORMAT = /^rly_live_[a-f0-9]{64}$/

interface ApiKeyRow {
  id: string
  name: string
  key_prefix: string
  status: 'active' | 'revoked'
}

interface BoundStatement {
  first<T>(): Promise<T | null>
  run(): Promise<unknown>
}

interface PreparedStatement {
  bind(...values: unknown[]): BoundStatement
}

export interface ApiKeyDatabase {
  prepare(query: string): PreparedStatement
}

export interface AuthenticatedApiKey {
  id: string
  name: string
  keyPrefix: string
}

export type ApiKeyAuthenticationFailure = 'missing' | 'malformed' | 'unknown' | 'revoked'

export type ApiKeyAuthenticationResult =
  | {
      ok: true
      apiKey: AuthenticatedApiKey
    }
  | {
      ok: false
      reason: ApiKeyAuthenticationFailure
    }

export async function authenticateApiKey(
  authorizationHeader: string | null,
  database: ApiKeyDatabase,
  usedAt = new Date().toISOString(),
): Promise<ApiKeyAuthenticationResult> {
  if (authorizationHeader === null) {
    return {
      ok: false,
      reason: 'missing',
    }
  }

  const rawKey = parseBearerToken(authorizationHeader)

  if (rawKey === null || !API_KEY_FORMAT.test(rawKey)) {
    return {
      ok: false,
      reason: 'malformed',
    }
  }

  const secretHash = await sha256Hex(rawKey)

  const row = await database
    .prepare(
      `SELECT id, name, key_prefix, status
       FROM api_keys
       WHERE secret_hash = ?
       LIMIT 1`,
    )
    .bind(secretHash)
    .first<ApiKeyRow>()

  if (row === null) {
    return {
      ok: false,
      reason: 'unknown',
    }
  }

  if (row.status === 'revoked') {
    return {
      ok: false,
      reason: 'revoked',
    }
  }

  await database
    .prepare(
      `UPDATE api_keys
       SET last_used_at = ?
       WHERE id = ?`,
    )
    .bind(usedAt, row.id)
    .run()

  return {
    ok: true,
    apiKey: {
      id: row.id,
      name: row.name,
      keyPrefix: row.key_prefix,
    },
  }
}
