import type { EndpointListResponse } from '@relay/contracts'
import { useCallback, useEffect, useState } from 'react'
import { StatusBadge } from '../components/StatusBadge'
import { formatLatency, formatNumber, formatTimestamp } from '../data/formatters'
import { getEndpoints } from '../lib/owner-api'

type EndpointSummary = EndpointListResponse['items'][number]

function formatRate(value: number | null) {
  return value === null ? '—' : `${value.toFixed(2)}%`
}

function formatAverageLatency(value: number | null) {
  return value === null ? '—' : formatLatency(value)
}

function formatOptionalTimestamp(value: string | null) {
  return value === null ? '—' : formatTimestamp(value)
}

function secretSummary(endpoint: EndpointSummary) {
  if (endpoint.secretGeneration === null) {
    return 'No signing secret provisioned'
  }

  return `Generation ${endpoint.secretGeneration}`
}

export function EndpointsPage() {
  const [result, setResult] = useState<EndpointListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadEndpoints = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      setResult(await getEndpoints())
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : 'Endpoint state could not be loaded.',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadEndpoints()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [loadEndpoints])

  return (
    <section className="page" aria-busy={loading}>
      <header className="page-header">
        <div>
          <p className="eyebrow">Destinations</p>
          <h1>Endpoints</h1>
          <p className="page-header__description">
            Inspect configured webhook destinations, verification state, delivery health,
            subscriptions, and signing-secret generations.
          </p>
        </div>

        <button
          className="secondary-button"
          type="button"
          disabled={loading}
          onClick={() => void loadEndpoints()}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      {loading && !result ? (
        <article className="panel operational-state" aria-live="polite">
          <h2>Loading endpoints</h2>
          <p>Reading current destination and delivery-health state.</p>
        </article>
      ) : null}

      {error ? (
        <article className="panel operational-state" role="alert">
          <h2>Endpoints unavailable</h2>
          <p>{error}</p>

          <button className="secondary-button" type="button" onClick={() => void loadEndpoints()}>
            Retry
          </button>
        </article>
      ) : null}

      {result && result.items.length === 0 ? (
        <article className="panel operational-state">
          <h2>No endpoints configured</h2>
          <p>Relay does not currently have any persisted webhook destinations.</p>
        </article>
      ) : null}

      {result && result.items.length > 0 ? (
        <div className="endpoint-grid">
          {result.items.map((endpoint) => (
            <article className="panel endpoint-card" key={endpoint.id}>
              <div className="endpoint-card__header">
                <div>
                  <h2>{endpoint.name}</h2>
                  <code>{endpoint.url}</code>
                </div>

                <div className="endpoint-card__badges">
                  <StatusBadge status={endpoint.status} />
                  <StatusBadge status={endpoint.health} />
                </div>
              </div>

              <div className="endpoint-metrics">
                <div>
                  <span>Success rate · 24h</span>
                  <strong>{formatRate(endpoint.successRate24h)}</strong>
                </div>

                <div>
                  <span>Average latency · 24h</span>
                  <strong>{formatAverageLatency(endpoint.averageLatencyMs24h)}</strong>
                </div>

                <div>
                  <span>Events · 24h</span>
                  <strong>{formatNumber(endpoint.eventCount24h)}</strong>
                </div>

                <div>
                  <span>Last delivery</span>
                  <strong>{formatOptionalTimestamp(endpoint.lastDeliveryAt)}</strong>
                </div>
              </div>

              <dl className="endpoint-detail-list">
                <div>
                  <dt>Endpoint ID</dt>
                  <dd>
                    <code>{endpoint.id}</code>
                  </dd>
                </div>

                <div>
                  <dt>Verified</dt>
                  <dd>{formatOptionalTimestamp(endpoint.verifiedAt)}</dd>
                </div>

                <div>
                  <dt>Updated</dt>
                  <dd>{formatTimestamp(endpoint.updatedAt)}</dd>
                </div>

                <div>
                  <dt>Signing secret</dt>
                  <dd>{secretSummary(endpoint)}</dd>
                </div>

                <div>
                  <dt>Previous secret valid until</dt>
                  <dd>{formatOptionalTimestamp(endpoint.previousSecretValidUntil)}</dd>
                </div>
              </dl>

              <div className="endpoint-subscriptions">
                <span>Subscriptions</span>

                {endpoint.subscriptions.length === 0 ? (
                  <p>No event subscriptions</p>
                ) : (
                  <ul>
                    {endpoint.subscriptions.map((subscription) => (
                      <li key={subscription}>
                        <code>{subscription}</code>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  )
}
