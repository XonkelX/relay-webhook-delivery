import type { RelayDatabase } from './database.js'
import {
  createEndpointSigningSecret,
  decryptEndpointSecret,
  encryptEndpointSecret,
  type EndpointSecretKeyring,
} from './endpoint-secret-crypto.js'

interface StoredSecretRow {
  key_version: string
  iv_base64: string
  ciphertext_base64: string
}

export async function resolveEndpointSigningSecret(
  database: RelayDatabase,
  endpointId: string,
  keyring: EndpointSecretKeyring,
): Promise<string> {
  const stored = await database
    .prepare(
      `SELECT
         key_version,
         iv_base64,
         ciphertext_base64
       FROM endpoint_signing_secrets
       WHERE endpoint_id = ?
         AND state = 'active'
       LIMIT 1`,
    )
    .bind(endpointId)
    .first<StoredSecretRow>()

  if (!stored) {
    throw new Error('Endpoint does not have an active signing secret.')
  }

  return decryptEndpointSecret(
    {
      keyVersion: stored.key_version,
      ivBase64: stored.iv_base64,
      ciphertextBase64: stored.ciphertext_base64,
    },
    endpointId,
    keyring,
  )
}

export const DEFAULT_SECRET_ROTATION_GRACE_SECONDS = 60 * 60
export const MAX_SECRET_ROTATION_GRACE_SECONDS = 24 * 60 * 60

interface StoredRotatingSecretRow {
  generation: number
  state: 'active' | 'previous'
  key_version: string
  iv_base64: string
  ciphertext_base64: string
  valid_until: string | null
}

export interface RotateEndpointSecretDependencies {
  nowMilliseconds?: () => number
  graceSeconds?: number
  createSecret?: () => string
}

export interface RotatedEndpointSecret {
  endpointId: string
  rawSecret: string
  generation: number
  keyVersion: string
  rotatedAt: string
  previousValidUntil: string
}

function validateGraceSeconds(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_SECRET_ROTATION_GRACE_SECONDS) {
    throw new TypeError(
      `Secret rotation grace must be an integer between 1 and ${MAX_SECRET_ROTATION_GRACE_SECONDS} seconds.`,
    )
  }
}

export async function rotateEndpointSigningSecret(
  database: RelayDatabase,
  endpointId: string,
  keyVersion: string,
  keyring: EndpointSecretKeyring,
  dependencies: RotateEndpointSecretDependencies = {},
): Promise<RotatedEndpointSecret> {
  const active = await database
    .prepare(
      `SELECT generation
       FROM endpoint_signing_secrets
       WHERE endpoint_id = ?
         AND state = 'active'
       LIMIT 1`,
    )
    .bind(endpointId)
    .first<{ generation: number }>()

  if (!active) {
    throw new Error('Endpoint does not have an active signing secret.')
  }

  const graceSeconds = dependencies.graceSeconds ?? DEFAULT_SECRET_ROTATION_GRACE_SECONDS

  validateGraceSeconds(graceSeconds)

  const nowMilliseconds = dependencies.nowMilliseconds ?? Date.now
  const rotatedMilliseconds = nowMilliseconds()
  const rotatedAt = new Date(rotatedMilliseconds).toISOString()
  const previousValidUntil = new Date(rotatedMilliseconds + graceSeconds * 1000).toISOString()

  const createSecret = dependencies.createSecret ?? createEndpointSigningSecret

  const rawSecret = createSecret()
  const generation = active.generation + 1

  const encrypted = await encryptEndpointSecret(rawSecret, endpointId, keyVersion, keyring)

  await database.batch([
    database
      .prepare(
        `DELETE FROM endpoint_signing_secrets
         WHERE endpoint_id = ?
           AND state = 'previous'`,
      )
      .bind(endpointId),

    database
      .prepare(
        `UPDATE endpoint_signing_secrets
         SET state = 'previous',
             valid_until = ?
         WHERE endpoint_id = ?
           AND generation = ?
           AND state = 'active'`,
      )
      .bind(previousValidUntil, endpointId, active.generation),

    database
      .prepare(
        `INSERT INTO endpoint_signing_secrets (
           endpoint_id,
           generation,
           state,
           key_version,
           iv_base64,
           ciphertext_base64,
           valid_until,
           created_at
         )
         VALUES (?, ?, 'active', ?, ?, ?, NULL, ?)`,
      )
      .bind(
        endpointId,
        generation,
        encrypted.keyVersion,
        encrypted.ivBase64,
        encrypted.ciphertextBase64,
        rotatedAt,
      ),
  ])

  return {
    endpointId,
    rawSecret,
    generation,
    keyVersion,
    rotatedAt,
    previousValidUntil,
  }
}

export async function resolveEndpointSigningSecrets(
  database: RelayDatabase,
  endpointId: string,
  keyring: EndpointSecretKeyring,
  nowMilliseconds: number = Date.now(),
): Promise<string[]> {
  const now = new Date(nowMilliseconds).toISOString()

  const result = await database
    .prepare(
      `SELECT
         generation,
         state,
         key_version,
         iv_base64,
         ciphertext_base64,
         valid_until
       FROM endpoint_signing_secrets
       WHERE endpoint_id = ?
         AND (
           state = 'active'
           OR (
             state = 'previous'
             AND valid_until > ?
           )
         )
       ORDER BY
         CASE state
           WHEN 'active' THEN 0
           ELSE 1
         END,
         generation DESC`,
    )
    .bind(endpointId, now)
    .all<StoredRotatingSecretRow>()

  if (result.results.length === 0) {
    throw new Error('Endpoint does not have an active signing secret.')
  }

  return Promise.all(
    result.results.map((stored) =>
      decryptEndpointSecret(
        {
          keyVersion: stored.key_version,
          ivBase64: stored.iv_base64,
          ciphertextBase64: stored.ciphertext_base64,
        },
        endpointId,
        keyring,
      ),
    ),
  )
}
