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

export interface ProvisionEndpointSecretDependencies {
  now?: () => string
  createSecret?: () => string
}

export interface ProvisionedEndpointSecret {
  endpointId: string
  rawSecret: string
  generation: number
  keyVersion: string
  createdAt: string
}

export async function provisionEndpointSigningSecret(
  database: RelayDatabase,
  endpointId: string,
  keyVersion: string,
  keyring: EndpointSecretKeyring,
  dependencies: ProvisionEndpointSecretDependencies = {},
): Promise<ProvisionedEndpointSecret> {
  const endpoint = await database
    .prepare(
      `SELECT id
       FROM endpoints
       WHERE id = ?
       LIMIT 1`,
    )
    .bind(endpointId)
    .first<{ id: string }>()

  if (!endpoint) {
    throw new Error('Endpoint does not exist.')
  }

  const existing = await database
    .prepare(
      `SELECT generation
       FROM endpoint_signing_secrets
       WHERE endpoint_id = ?
         AND state = 'active'
       LIMIT 1`,
    )
    .bind(endpointId)
    .first<{ generation: number }>()

  if (existing) {
    throw new Error('Endpoint already has an active signing secret.')
  }

  const createSecret = dependencies.createSecret ?? createEndpointSigningSecret
  const now = dependencies.now ?? (() => new Date().toISOString())

  const rawSecret = createSecret()
  const createdAt = now()
  const generation = 1

  const encrypted = await encryptEndpointSecret(rawSecret, endpointId, keyVersion, keyring)

  await database
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
      createdAt,
    )
    .run()

  return {
    endpointId,
    rawSecret,
    generation,
    keyVersion,
    createdAt,
  }
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
