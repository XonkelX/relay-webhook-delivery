import type { SystemHealthResponse } from '@relay/contracts'
import type { RelayDatabase } from './database.js'
import { operationalGuardrails } from './operational-guardrails.js'
import { calculateSuccessRate, loadOperationalMetrics } from './owner-operational-metrics.js'

interface QuotaRow {
  per_key_daily_events: number
  global_daily_events: number
  accepted_event_count: number
}

export async function loadOwnerSystemHealth(
  database: RelayDatabase,
  now: Date = new Date(),
): Promise<SystemHealthResponse> {
  const metrics = await loadOperationalMetrics(database, now)

  const usageDate = now.toISOString().slice(0, 10)

  const quota = await database
    .prepare(
      `SELECT
         quota_limits.per_key_daily_events,
         quota_limits.global_daily_events,
         COALESCE(
           global_daily_usage.accepted_event_count,
           0
         ) AS accepted_event_count
       FROM quota_limits
       LEFT JOIN global_daily_usage
         ON global_daily_usage.usage_date = ?
       WHERE quota_limits.id = 1
       LIMIT 1`,
    )
    .bind(usageDate)
    .first<QuotaRow>()

  if (!quota) {
    throw new Error('Quota configuration is unavailable.')
  }

  return {
    queuedDeliveries: metrics.queuedNow,
    oldestQueuedAt: metrics.oldestQueuedAt,
    retryingDeliveries: metrics.retryingNow,
    oldestRetryAt: metrics.oldestRetryAt,
    pendingOutbox: metrics.pendingOutbox,
    oldestPendingOutboxAt: metrics.oldestPendingOutboxAt,
    successRate24h: calculateSuccessRate(metrics.delivered24h, metrics.exhausted24h),
    medianLatencyMs24h: metrics.medianLatencyMs24h,
    quotas: {
      perKeyDailyEventLimit: quota.per_key_daily_events,
      globalDailyEventLimit: quota.global_daily_events,
      globalAcceptedEventsToday: quota.accepted_event_count,
    },
    guardrails: operationalGuardrails,
  }
}
