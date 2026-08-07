import type { OverviewResponse } from '@relay/contracts'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { StatusBadge } from '../components/StatusBadge'
import { formatLatency, formatNumber, formatTimestamp } from '../data/formatters'
import { getOverview } from '../lib/owner-api'

function formatSuccessRate(value: number | null): string {
  if (value === null) {
    return 'No terminal deliveries'
  }

  return `${value.toFixed(2)}% successful`
}

function formatDeliverySummary(event: OverviewResponse['recentEvents'][number]): string {
  if (event.deliveries.total === 0) {
    return 'No deliveries generated'
  }

  return `${event.deliveries.delivered}/${event.deliveries.total} delivered`
}

export function OverviewPage() {
  const [overview, setOverview] = useState<OverviewResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const loadOverview = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      setOverview(await getOverview())
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Operational overview could not be loaded.',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadOverview()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [loadOverview])

  return (
    <section className="page" aria-busy={loading}>
      <header className="page-header">
        <div>
          <p className="eyebrow">Operations overview</p>
          <h1>Delivery control plane</h1>
          <p className="page-header__description">
            Monitor webhook throughput, delivery health, retries, and destination reliability from
            one place.
          </p>
        </div>

        <Link className="primary-button" to="/console/failure-lab">
          Open Failure Lab
        </Link>
      </header>

      {loading && !overview ? (
        <article className="panel operational-state" aria-live="polite">
          <h2>Loading operations</h2>
          <p>Reading current delivery and endpoint state from Relay.</p>
        </article>
      ) : null}

      {error ? (
        <article className="panel operational-state" role="alert">
          <h2>Overview unavailable</h2>
          <p>{error}</p>
          <button className="secondary-button" type="button" onClick={() => void loadOverview()}>
            Retry
          </button>
        </article>
      ) : null}

      {overview ? (
        <>
          <div className="overview-metrics">
            <article className="panel">
              <span>Events · 24h</span>
              <strong>{formatNumber(overview.events24h)}</strong>
              <small>
                {formatNumber(overview.activeEndpointCount)} active of{' '}
                {formatNumber(overview.endpointCount)} endpoints
              </small>
            </article>

            <article className="panel">
              <span>Delivered · 24h</span>
              <strong>{formatNumber(overview.delivered24h)}</strong>
              <small>{formatSuccessRate(overview.successRate24h)}</small>
            </article>

            <article className="panel">
              <span>Retrying</span>
              <strong>{formatNumber(overview.retryingNow)}</strong>
              <small>
                {overview.oldestRetryAt
                  ? `Oldest due ${formatTimestamp(overview.oldestRetryAt)}`
                  : 'No deliveries awaiting retry'}
              </small>
            </article>

            <article className="panel">
              <span>Median latency · 24h</span>
              <strong>
                {overview.medianLatencyMs24h === null
                  ? '—'
                  : formatLatency(overview.medianLatencyMs24h)}
              </strong>
              <small>Completed outbound attempts</small>
            </article>
          </div>

          <div className="overview-layout">
            <article className="panel">
              <div className="panel__header">
                <div>
                  <h2>Recent events</h2>
                  <p>Latest accepted webhook events</p>
                </div>
              </div>

              {overview.recentEvents.length === 0 ? (
                <p className="overview-empty">No events have been accepted yet.</p>
              ) : (
                <div className="overview-event-list">
                  {overview.recentEvents.map((event) => (
                    <div className="overview-event-row" key={event.id}>
                      <div>
                        <strong>{event.eventType}</strong>
                        <span>{formatDeliverySummary(event)}</span>
                      </div>

                      <StatusBadge status={event.status} />

                      <time>{formatTimestamp(event.createdAt)}</time>
                    </div>
                  ))}
                </div>
              )}
            </article>

            <article className="panel">
              <div className="panel__header">
                <div>
                  <h2>Endpoint health</h2>
                  <p>Current destination performance</p>
                </div>
              </div>

              {overview.endpoints.length === 0 ? (
                <p className="overview-empty">No endpoints are configured.</p>
              ) : (
                <div className="overview-endpoint-list">
                  {overview.endpoints.map((endpoint) => (
                    <div className="overview-endpoint-row" key={endpoint.id}>
                      <div>
                        <strong>{endpoint.name}</strong>
                        <span>
                          {endpoint.averageLatencyMs24h === null
                            ? 'No completed attempts'
                            : `${formatLatency(endpoint.averageLatencyMs24h)} average`}
                        </span>
                      </div>

                      <StatusBadge status={endpoint.health} />
                    </div>
                  ))}
                </div>
              )}
            </article>
          </div>
        </>
      ) : null}
    </section>
  )
}
