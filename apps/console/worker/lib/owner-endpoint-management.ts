import type {
  EndpointStatus,
  OwnerEndpointStatusTarget,
  OwnerEndpointStatusUpdateResponse,
} from '@relay/contracts'
import { canonicalizeJson } from './canonical-json.js'
import type { RelayDatabase, RelayStatement } from './database.js'
import type { RelayIdPrefix } from './ids.js'
import { createPrefixedId } from './ids.js'

interface EndpointStatusRow {
  status: EndpointStatus
  updated_at: string
}

export type UpdateOwnerEndpointStatusResult =
  | {
      ok: true
      value: OwnerEndpointStatusUpdateResponse
    }
  | {
      ok: false
      reason: 'missing' | 'ineligible'
      status?: EndpointStatus
    }

export interface UpdateOwnerEndpointStatusDependencies {
  now?: () => string
  createId?: (prefix: RelayIdPrefix) => string
}

function canTransition(current: EndpointStatus, target: OwnerEndpointStatusTarget): boolean {
  if (current === target) {
    return true
  }

  return (
    (current === 'active' && target === 'paused') || (current === 'paused' && target === 'active')
  )
}

export async function updateOwnerEndpointStatus(
  database: RelayDatabase,
  endpointId: string,
  targetStatus: OwnerEndpointStatusTarget,
  dependencies: UpdateOwnerEndpointStatusDependencies = {},
): Promise<UpdateOwnerEndpointStatusResult> {
  const current = await database
    .prepare(
      `SELECT status, updated_at
       FROM endpoints
       WHERE id = ?
       LIMIT 1`,
    )
    .bind(endpointId)
    .first<EndpointStatusRow>()

  if (!current) {
    return {
      ok: false,
      reason: 'missing',
    }
  }

  if (!canTransition(current.status, targetStatus)) {
    return {
      ok: false,
      reason: 'ineligible',
      status: current.status,
    }
  }

  if (current.status === targetStatus) {
    return {
      ok: true,
      value: {
        endpointId,
        status: targetStatus,
        updatedAt: current.updated_at,
        changed: false,
      },
    }
  }

  const now = dependencies.now ?? (() => new Date().toISOString())
  const createId = dependencies.createId ?? createPrefixedId
  const updatedAt = now()

  const action = targetStatus === 'paused' ? 'endpoint.paused' : 'endpoint.resumed'

  const statements: RelayStatement[] = [
    database
      .prepare(
        `UPDATE endpoints
         SET status = ?,
             updated_at = ?
         WHERE id = ?
           AND status = ?`,
      )
      .bind(targetStatus, updatedAt, endpointId, current.status),

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
         SELECT
           ?,
           'owner',
           ?,
           'endpoint',
           ?,
           ?,
           ?
         FROM endpoints
         WHERE id = ?
           AND status = ?
           AND updated_at = ?`,
      )
      .bind(
        createId('aud'),
        action,
        endpointId,
        canonicalizeJson({
          from: current.status,
          to: targetStatus,
        }),
        updatedAt,
        endpointId,
        targetStatus,
        updatedAt,
      ),
  ]

  await database.batch(statements)

  const updated = await database
    .prepare(
      `SELECT status, updated_at
       FROM endpoints
       WHERE id = ?
       LIMIT 1`,
    )
    .bind(endpointId)
    .first<EndpointStatusRow>()

  if (!updated || updated.status !== targetStatus || updated.updated_at !== updatedAt) {
    return {
      ok: false,
      reason: 'ineligible',
      ...(updated ? { status: updated.status } : {}),
    }
  }

  return {
    ok: true,
    value: {
      endpointId,
      status: targetStatus,
      updatedAt,
      changed: true,
    },
  }
}
