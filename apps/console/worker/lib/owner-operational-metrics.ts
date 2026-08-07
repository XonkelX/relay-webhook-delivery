import type { RelayDatabase } from './database.js'

export interface OperationalMetrics {
  events24h: number
  deliveries24h: number
  delivered24h: number
  exhausted24h: number
  retryingNow: number
  oldestRetryAt: string | null
  queuedNow: number
  oldestQueuedAt: string | null
  pendingOutbox: number
  oldestPendingOutboxAt: string | null
  medianLatencyMs24h: number | null
}

interface OperationalMetricsRow {
  events_24h: number
  deliveries_24h: number
  delivered_24h: number
  exhausted_24h: number
  retrying_now: number
  oldest_retry_at: string | null
  queued_now: number
  oldest_queued_at: string | null
  pending_outbox: number
  oldest_pending_outbox_at: string | null
  median_latency_ms_24h: number | null
}

export async function loadOperationalMetrics(
  database: RelayDatabase,
  now: Date = new Date(),
): Promise<OperationalMetrics> {
  const nowIso = now.toISOString()
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()

  const row = await database
    .prepare(
      `WITH recent_latency AS (
         SELECT CAST(latency_ms AS REAL) AS latency_ms
         FROM delivery_attempts
         WHERE state = 'completed'
           AND completed_at >= ?
           AND latency_ms IS NOT NULL
       ),
       ranked_latency AS (
         SELECT
           latency_ms,
           ROW_NUMBER() OVER (
             ORDER BY latency_ms
           ) AS row_number,
           COUNT(*) OVER () AS total_count
         FROM recent_latency
       )
       SELECT
         (
           SELECT COUNT(*)
           FROM events
           WHERE created_at >= ?
         ) AS events_24h,

         (
           SELECT COUNT(*)
           FROM deliveries
           WHERE created_at >= ?
         ) AS deliveries_24h,

         (
           SELECT COUNT(*)
           FROM deliveries
           WHERE delivered_at >= ?
         ) AS delivered_24h,

         (
           SELECT COUNT(*)
           FROM deliveries
           WHERE exhausted_at >= ?
         ) AS exhausted_24h,

         (
           SELECT COUNT(*)
           FROM deliveries
           WHERE status = 'retrying'
         ) AS retrying_now,

         (
           SELECT MIN(next_attempt_at)
           FROM deliveries
           WHERE status = 'retrying'
         ) AS oldest_retry_at,

         (
           SELECT COUNT(*)
           FROM deliveries
           WHERE status = 'queued'
         ) AS queued_now,

         (
           SELECT MIN(created_at)
           FROM deliveries
           WHERE status = 'queued'
         ) AS oldest_queued_at,

         (
           SELECT COUNT(*)
           FROM delivery_outbox
           WHERE published_at IS NULL
             AND available_at <= ?
         ) AS pending_outbox,

         (
           SELECT MIN(available_at)
           FROM delivery_outbox
           WHERE published_at IS NULL
             AND available_at <= ?
         ) AS oldest_pending_outbox_at,

         (
           SELECT AVG(latency_ms)
           FROM ranked_latency
           WHERE row_number IN (
             (total_count + 1) / 2,
             (total_count + 2) / 2
           )
         ) AS median_latency_ms_24h`,
    )
    .bind(since24h, since24h, since24h, since24h, since24h, nowIso, nowIso)
    .first<OperationalMetricsRow>()

  if (!row) {
    throw new Error('Operational metrics query returned no row.')
  }

  return {
    events24h: row.events_24h,
    deliveries24h: row.deliveries_24h,
    delivered24h: row.delivered_24h,
    exhausted24h: row.exhausted_24h,
    retryingNow: row.retrying_now,
    oldestRetryAt: row.oldest_retry_at,
    queuedNow: row.queued_now,
    oldestQueuedAt: row.oldest_queued_at,
    pendingOutbox: row.pending_outbox,
    oldestPendingOutboxAt: row.oldest_pending_outbox_at,
    medianLatencyMs24h: row.median_latency_ms_24h,
  }
}

export function calculateSuccessRate(delivered: number, exhausted: number): number | null {
  const terminal = delivered + exhausted

  if (terminal === 0) {
    return null
  }

  return (delivered / terminal) * 100
}
