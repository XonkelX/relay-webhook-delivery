import { canonicalizeJson } from './canonical-json.js'
import {
  createEndpointSigningSecret,
  encryptEndpointSecret,
  type EndpointSecretKeyring,
} from './endpoint-secret-crypto.js'
import { normalizeEndpointUrl } from './endpoint-url-policy.js'
import type { RelayDatabase, RelayStatement } from './database.js'
import type { RelayIdPrefix } from './ids.js'
import { createPrefixedId } from './ids.js'

export interface CreateEndpointInput {
  name: string
  url: string
  eventTypes: readonly string[]
}

export interface PersistedEndpoint {
  id: string
  name: string
  url: string
  status: 'pending'
  signingSecret: string
  eventTypes: string[]
  createdAt: string
}

export interface EndpointPersistenceDependencies {
  now?: () => string
  createId?: (prefix: RelayIdPrefix) => string
}

export interface CreateEndpointDependencies extends EndpointPersistenceDependencies {
  endpointSecretKeyVersion: string
  endpointSecretKeyring: EndpointSecretKeyring
  createSigningSecret?: () => string
}

function normalizeName(name: string): string {
  const normalized = name.trim()

  if (normalized.length < 1 || normalized.length > 100) {
    throw new TypeError('Endpoint name must contain between 1 and 100 characters.')
  }

  return normalized
}

function normalizeEventTypes(eventTypes: readonly string[]): string[] {
  const normalized = new Set<string>()

  for (const rawEventType of eventTypes) {
    const eventType = rawEventType.trim()

    if (eventType.length < 1 || eventType.length > 120) {
      throw new TypeError('Event types must contain between 1 and 120 characters.')
    }

    normalized.add(eventType)
  }

  return [...normalized].sort()
}

export async function createEndpoint(
  database: RelayDatabase,
  input: CreateEndpointInput,
  dependencies: CreateEndpointDependencies,
): Promise<PersistedEndpoint> {
  const name = normalizeName(input.name)
  const url = normalizeEndpointUrl(input.url)
  const eventTypes = normalizeEventTypes(input.eventTypes)
  const now = dependencies.now ?? (() => new Date().toISOString())
  const createId = dependencies.createId ?? createPrefixedId
  const createdAt = now()
  const endpointId = createId('ep')
  const createSigningSecret = dependencies.createSigningSecret ?? createEndpointSigningSecret
  const signingSecret = createSigningSecret()
  const encryptedSigningSecret = await encryptEndpointSecret(
    signingSecret,
    endpointId,
    dependencies.endpointSecretKeyVersion,
    dependencies.endpointSecretKeyring,
  )
  const statements: RelayStatement[] = []

  statements.push(
    database
      .prepare(
        `INSERT INTO endpoints (
           id,
           name,
           url,
           status,
           created_at,
           updated_at
         )
         VALUES (?, ?, ?, 'pending', ?, ?)`,
      )
      .bind(endpointId, name, url, createdAt, createdAt),
  )

  statements.push(
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
         VALUES (?, 1, 'active', ?, ?, ?, NULL, ?)`,
      )
      .bind(
        endpointId,
        encryptedSigningSecret.keyVersion,
        encryptedSigningSecret.ivBase64,
        encryptedSigningSecret.ciphertextBase64,
        createdAt,
      ),
  )

  for (const eventType of eventTypes) {
    statements.push(
      database
        .prepare(
          `INSERT INTO endpoint_subscriptions (
             endpoint_id,
             event_type,
             created_at
           )
           VALUES (?, ?, ?)`,
        )
        .bind(endpointId, eventType, createdAt),
    )
  }

  statements.push(
    database
      .prepare(
        `INSERT INTO audit_log (
           id,
           actor_type,
           action,
           target_type,
           target_id,
           metadata_json,
           created_at
         )
         VALUES (?, 'owner', 'endpoint.created', 'endpoint', ?, ?, ?)`,
      )
      .bind(createId('aud'), endpointId, canonicalizeJson({ eventTypes }), createdAt),
  )

  await database.batch(statements)

  return {
    id: endpointId,
    name,
    url,
    status: 'pending',
    signingSecret,
    eventTypes,
    createdAt,
  }
}

export async function replaceEndpointSubscriptions(
  database: RelayDatabase,
  endpointId: string,
  eventTypesInput: readonly string[],
  dependencies: EndpointPersistenceDependencies = {},
): Promise<{ updated: boolean; eventTypes: string[] }> {
  const endpoint = await database
    .prepare(
      `SELECT id
       FROM endpoints
       WHERE id = ?
       LIMIT 1`,
    )
    .bind(endpointId)
    .first<{ id: string }>()

  const eventTypes = normalizeEventTypes(eventTypesInput)

  if (!endpoint) {
    return {
      updated: false,
      eventTypes,
    }
  }

  const now = dependencies.now ?? (() => new Date().toISOString())
  const createId = dependencies.createId ?? createPrefixedId
  const updatedAt = now()
  const statements: RelayStatement[] = [
    database
      .prepare(
        `DELETE FROM endpoint_subscriptions
         WHERE endpoint_id = ?`,
      )
      .bind(endpointId),
  ]
  for (const eventType of eventTypes) {
    statements.push(
      database
        .prepare(
          `INSERT INTO endpoint_subscriptions (
             endpoint_id,
             event_type,
             created_at
           )
           VALUES (?, ?, ?)`,
        )
        .bind(endpointId, eventType, updatedAt),
    )
  }

  statements.push(
    database
      .prepare(
        `INSERT INTO audit_log (
           id,
           actor_type,
           action,
           target_type,
           target_id,
           metadata_json,
           created_at
         )
         VALUES (
           ?,
           'owner',
           'endpoint.subscriptions.updated',
           'endpoint',
           ?,
           ?,
           ?
         )`,
      )
      .bind(createId('aud'), endpointId, canonicalizeJson({ eventTypes }), updatedAt),
  )

  await database.batch(statements)

  return {
    updated: true,
    eventTypes,
  }
}

export type UpdateEndpointUrlResult =
  | {
      updated: true
      url: string
      status: 'pending'
    }
  | {
      updated: false
      reason: 'missing' | 'unchanged'
      url: string
    }

export async function updateEndpointUrl(
  database: RelayDatabase,
  endpointId: string,
  urlInput: string,
  dependencies: EndpointPersistenceDependencies = {},
): Promise<UpdateEndpointUrlResult> {
  const url = normalizeEndpointUrl(urlInput)

  const endpoint = await database
    .prepare(
      `SELECT url
       FROM endpoints
       WHERE id = ?
       LIMIT 1`,
    )
    .bind(endpointId)
    .first<{ url: string }>()

  if (!endpoint) {
    return {
      updated: false,
      reason: 'missing',
      url,
    }
  }

  if (endpoint.url === url) {
    return {
      updated: false,
      reason: 'unchanged',
      url,
    }
  }

  const now = dependencies.now ?? (() => new Date().toISOString())
  const createId = dependencies.createId ?? createPrefixedId
  const updatedAt = now()

  await database.batch([
    database
      .prepare(
        `UPDATE endpoints
         SET url = ?,
             status = 'pending',
             verified_at = NULL,
             disabled_at = NULL,
             verification_challenge_hash = NULL,
             verification_expires_at = NULL,
             verification_attempted_at = NULL,
             updated_at = ?
         WHERE id = ?`,
      )
      .bind(url, updatedAt, endpointId),

    database
      .prepare(
        `DELETE FROM delivery_outbox
         WHERE published_at IS NULL
           AND delivery_id IN (
             SELECT id
             FROM deliveries
             WHERE endpoint_id = ?
               AND status IN (
                 'queued',
                 'retrying',
                 'leased'
               )
           )`,
      )
      .bind(endpointId),

    database
      .prepare(
        `UPDATE deliveries
         SET status = 'cancelled',
             lease_token = NULL,
             lease_expires_at = NULL,
             last_error_class = 'endpoint_url_changed',
             updated_at = ?
         WHERE endpoint_id = ?
           AND status IN (
             'queued',
             'retrying',
             'leased'
           )`,
      )
      .bind(updatedAt, endpointId),

    database
      .prepare(
        `INSERT INTO audit_log (
           id,
           actor_type,
           action,
           target_type,
           target_id,
           metadata_json,
           created_at
         )
         VALUES (
           ?,
           'owner',
           'endpoint.url.updated',
           'endpoint',
           ?,
           ?,
           ?
         )`,
      )
      .bind(
        createId('aud'),
        endpointId,
        canonicalizeJson({
          previousUrl: endpoint.url,
          url,
        }),
        updatedAt,
      ),
  ])

  return {
    updated: true,
    url,
    status: 'pending',
  }
}
