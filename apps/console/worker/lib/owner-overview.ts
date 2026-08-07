import type { OverviewResponse } from '@relay/contracts'
import type { RelayDatabase } from './database.js'
import { listOwnerEndpoints } from './owner-endpoints.js'
import { listOwnerEvents } from './owner-events.js'
import { calculateSuccessRate, loadOperationalMetrics } from './owner-operational-metrics.js'

export async function loadOwnerOverview(
  database: RelayDatabase,
  now: Date = new Date(),
): Promise<OverviewResponse> {
  const [metrics, eventList, endpointList] = await Promise.all([
    loadOperationalMetrics(database, now),
    listOwnerEvents(
      database,
      {
        limit: 10,
      },
      {
        now: () => now,
      },
    ),
    listOwnerEndpoints(database, now),
  ])

  return {
    events24h: metrics.events24h,
    deliveries24h: metrics.deliveries24h,
    delivered24h: metrics.delivered24h,
    retryingNow: metrics.retryingNow,
    exhausted24h: metrics.exhausted24h,
    successRate24h: calculateSuccessRate(metrics.delivered24h, metrics.exhausted24h),
    medianLatencyMs24h: metrics.medianLatencyMs24h,
    endpointCount: endpointList.items.length,
    activeEndpointCount: endpointList.items.filter((endpoint) => endpoint.status === 'active')
      .length,
    oldestRetryAt: metrics.oldestRetryAt,
    recentEvents: eventList.items,
    endpoints: endpointList.items.slice(0, 10),
  }
}
