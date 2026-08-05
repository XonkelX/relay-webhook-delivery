import { createApiKeyMaterial, type ApiKeyMaterial } from './auth.js'
import type { RelayDatabase } from './database.js'
import type { RelayIdPrefix } from './ids.js'
import { createPrefixedId } from './ids.js'

export interface CreatedApiKey {
  id: string
  name: string
  keyPrefix: string
  rawKey: string
  status: 'active'
  createdAt: string
}

export interface CreateApiKeyDependencies {
  now?: () => string
  createId?: (prefix: RelayIdPrefix) => string
  createMaterial?: () => Promise<ApiKeyMaterial>
}

export async function createApiKey(
  database: RelayDatabase,
  name: string,
  dependencies: CreateApiKeyDependencies = {},
): Promise<CreatedApiKey> {
  const normalizedName = name.trim()

  if (normalizedName.length < 1 || normalizedName.length > 80) {
    throw new TypeError('API key name must contain between 1 and 80 characters.')
  }

  const now = dependencies.now ?? (() => new Date().toISOString())
  const createId = dependencies.createId ?? createPrefixedId
  const createMaterial = dependencies.createMaterial ?? createApiKeyMaterial

  const id = createId('key')
  const createdAt = now()
  const material = await createMaterial()

  await database
    .prepare(
      `INSERT INTO api_keys (
         id,
         name,
         key_prefix,
         secret_hash,
         status,
         created_at
       )
       VALUES (?, ?, ?, ?, 'active', ?)`,
    )
    .bind(id, normalizedName, material.keyPrefix, material.secretHash, createdAt)
    .run()

  return {
    id,
    name: normalizedName,
    keyPrefix: material.keyPrefix,
    rawKey: material.rawKey,
    status: 'active',
    createdAt,
  }
}
