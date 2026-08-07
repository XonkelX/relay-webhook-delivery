import type { DeliveryStatus, EventListResponse, EventOperationalStatus } from '@relay/contracts'
import { DeliveryStatusSchema, EventIdSchema, EventTypeSchema } from '@relay/contracts'
import type { RelayDatabase } from './database.js'

const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 100
const MAX_CURSOR_LENGTH = 512

interface EventCursor {
  createdAt: string
  id: string
}

interface EventRow {
  id: string
  event_type: string
  created_at: string
  payload_bytes: number
  queued_count: number
  leased_count: number
  retrying_count: number
  delivered_count: number
  exhausted_count: number
  cancelled_count: number
  delivery_count: number
}

interface MetricsRow {
  events_24h: number
  delivered_24h: number
  retrying_now: number
  exhausted_24h: number
}

export interface OwnerEventListOptions {
  limit: number
  eventType?: string
  status?: DeliveryStatus
  cursor?: EventCursor
}

export interface OwnerEventListDependencies {
  now?: () => Date
}

function encodeBase64Url(value: string): string {
  return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

function decodeBase64Url(value: string): string {
  if (value.length === 0 || value.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new TypeError('Invalid event cursor.')
  }

  const base64 = value
    .replaceAll('-', '+')
    .replaceAll('_', '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=')

  return atob(base64)
}

export function encodeEventCursor(cursor: EventCursor): string {
  return encodeBase64Url(JSON.stringify(cursor))
}

export function decodeEventCursor(value: string): EventCursor {
  let parsed: unknown

  try {
    parsed = JSON.parse(decodeBase64Url(value))
  } catch {
    throw new TypeError('Invalid event cursor.')
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypeError('Invalid event cursor.')
  }

  const record = parsed as Record<string, unknown>

  if (
    Object.keys(record).length !== 2 ||
    typeof record.createdAt !== 'string' ||
    typeof record.id !== 'string' ||
    Number.isNaN(Date.parse(record.createdAt)) ||
    !EventIdSchema.safeParse(record.id).success
  ) {
    throw new TypeError('Invalid event cursor.')
  }

  return {
    createdAt: record.createdAt,
    id: record.id,
  }
}

export function parseOwnerEventListQuery(requestUrl: string): OwnerEventListOptions {
  const url = new URL(requestUrl)
  const limitRaw = url.searchParams.get('limit')
  const eventTypeRaw = url.searchParams.get('eventType')
  const statusRaw = url.searchParams.get('status')
  const cursorRaw = url.searchParams.get('cursor')

  let limit = DEFAULT_PAGE_SIZE

  if (limitRaw !== null) {
    if (!/^\d+$/u.test(limitRaw)) {
      throw new TypeError('Invalid event list limit.')
    }

    limit = Number(limitRaw)

    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
      throw new TypeError('Invalid event list limit.')
    }
  }

  let eventType: string | undefined

  if (eventTypeRaw !== null) {
    const parsed = EventTypeSchema.safeParse(eventTypeRaw)

    if (!parsed.success) {
      throw new TypeError('Invalid event type filter.')
    }

    eventType = parsed.data
  }

  let status: DeliveryStatus | undefined

  if (statusRaw !== null) {
    const parsed = DeliveryStatusSchema.safeParse(statusRaw)

    if (!parsed.success) {
      throw new TypeError('Invalid delivery status filter.')
    }

    status = parsed.data
  }

  return {
    limit,
    ...(eventType ? { eventType } : {}),
    ...(status ? { status } : {}),
    ...(cursorRaw ? { cursor: decodeEventCursor(cursorRaw) } : {}),
  }
}

function deriveOperationalStatus(row: EventRow): EventOperationalStatus {
  if (row.delivery_count === 0) {
    return 'no_deliveries'
  }

  const activeStatuses: DeliveryStatus[] = []

  if (row.queued_count > 0) activeStatuses.push('queued')
  if (row.leased_count > 0) activeStatuses.push('leased')
  if (row.retrying_count > 0) activeStatuses.push('retrying')
  if (row.delivered_count > 0) activeStatuses.push('delivered')
  if (row.exhausted_count > 0) activeStatuses.push('exhausted')
  if (row.cancelled_count > 0) activeStatuses.push('cancelled')

  return activeStatuses.length === 1 ? activeStatuses[0]! : 'mixed'
}

export async function listOwnerEvents(
  database: RelayDatabase,
  options: OwnerEventListOptions,
  dependencies: OwnerEventListDependencies = {},
): Promise<EventListResponse> {
  const clauses: string[] = []
  const bindings: unknown[] = []

  if (options.eventType) {
    clauses.push('events.event_type = ?')
    bindings.push(options.eventType)
  }

  if (options.status) {
    clauses.push(
      `EXISTS (
         SELECT 1
         FROM deliveries AS filtered_deliveries
         WHERE filtered_deliveries.event_id = events.id
           AND filtered_deliveries.status = ?
       )`,
    )
    bindings.push(options.status)
  }

  if (options.cursor) {
    clauses.push(
      `(events.created_at < ?
       OR (
         events.created_at = ?
         AND events.id < ?
       ))`,
    )
    bindings.push(options.cursor.createdAt, options.cursor.createdAt, options.cursor.id)
  }

  const where = clauses.length === 0 ? '' : `WHERE ${clauses.join('\n AND ')}`

  const result = await database
    .prepare(
      `SELECT
         events.id,
         events.event_type,
         events.created_at,
         events.payload_bytes,
         SUM(
           CASE WHEN deliveries.status = 'queued'
             THEN 1 ELSE 0 END
         ) AS queued_count,
         SUM(
           CASE WHEN deliveries.status = 'leased'
             THEN 1 ELSE 0 END
         ) AS leased_count,
         SUM(
           CASE WHEN deliveries.status = 'retrying'
             THEN 1 ELSE 0 END
         ) AS retrying_count,
         SUM(
           CASE WHEN deliveries.status = 'delivered'
             THEN 1 ELSE 0 END
         ) AS delivered_count,
         SUM(
           CASE WHEN deliveries.status = 'exhausted'
             THEN 1 ELSE 0 END
         ) AS exhausted_count,
         SUM(
           CASE WHEN deliveries.status = 'cancelled'
             THEN 1 ELSE 0 END
         ) AS cancelled_count,
         COUNT(deliveries.id) AS delivery_count
       FROM events
       LEFT JOIN deliveries
         ON deliveries.event_id = events.id
       ${where}
       GROUP BY
         events.id,
         events.event_type,
         events.created_at,
         events.payload_bytes
       ORDER BY
         events.created_at DESC,
         events.id DESC
       LIMIT ?`,
    )
    .bind(...bindings, options.limit + 1)
    .all<EventRow>()

  const hasMore = result.results.length > options.limit
  const pageRows = result.results.slice(0, options.limit)

  const now = dependencies.now?.() ?? new Date()
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()

  const metrics = (await database
    .prepare(
      `SELECT
           (
             SELECT COUNT(*)
             FROM events
             WHERE created_at >= ?
           ) AS events_24h,
           (
             SELECT COUNT(*)
             FROM deliveries
             WHERE delivered_at IS NOT NULL
               AND delivered_at >= ?
           ) AS delivered_24h,
           (
             SELECT COUNT(*)
             FROM deliveries
             WHERE status = 'retrying'
           ) AS retrying_now,
           (
             SELECT COUNT(*)
             FROM deliveries
             WHERE exhausted_at IS NOT NULL
               AND exhausted_at >= ?
           ) AS exhausted_24h`,
    )
    .bind(since24h, since24h, since24h)
    .first<MetricsRow>()) ?? {
    events_24h: 0,
    delivered_24h: 0,
    retrying_now: 0,
    exhausted_24h: 0,
  }

  const terminalCount = metrics.delivered_24h + metrics.exhausted_24h

  const items = pageRows.map((row) => ({
    id: row.id,
    eventType: row.event_type,
    createdAt: row.created_at,
    payloadBytes: row.payload_bytes,
    status: deriveOperationalStatus(row),
    deliveries: {
      queued: row.queued_count,
      leased: row.leased_count,
      retrying: row.retrying_count,
      delivered: row.delivered_count,
      exhausted: row.exhausted_count,
      cancelled: row.cancelled_count,
      total: row.delivery_count,
    },
  }))

  const lastItem = items.at(-1)

  return {
    items,
    nextCursor:
      hasMore && lastItem
        ? encodeEventCursor({
            createdAt: lastItem.createdAt,
            id: lastItem.id,
          })
        : null,
    metrics: {
      events24h: metrics.events_24h,
      deliveredDeliveries24h: metrics.delivered_24h,
      retryingDeliveriesNow: metrics.retrying_now,
      exhaustedDeliveries24h: metrics.exhausted_24h,
      successRate24h: terminalCount === 0 ? null : (metrics.delivered_24h / terminalCount) * 100,
    },
  }
}
