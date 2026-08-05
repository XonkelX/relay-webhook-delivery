import { useState } from 'react'
import { StatePanel } from '../components/StatePanel'
import { StatusBadge } from '../components/StatusBadge'
import { endpointFixtures } from '../data/endpoints'
import { formatLatency, formatNumber, formatTimestamp } from '../data/formatters'

export function EndpointsPage() {
  const [showDisabledState, setShowDisabledState] = useState(false)

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Destinations</p>
          <h1>Endpoints</h1>
          <p className="page-header__description">
            Manage webhook destinations and inspect their recent delivery health.
          </p>
        </div>

        <button className="primary-button" type="button">
          Add endpoint
        </button>
      </header>

      <div className="panel endpoint-preview-panel">
        <div className="panel__header">
          <div>
            <h2>Endpoint state preview</h2>
            <p>Review the disabled-endpoint interaction state</p>
          </div>

          <label className="state-preview-control">
            <span>Preview state</span>
            <select
              value={showDisabledState ? 'disabled' : 'live'}
              onChange={(event) => setShowDisabledState(event.target.value === 'disabled')}
            >
              <option value="live">Live endpoints</option>
              <option value="disabled">Endpoint disabled</option>
            </select>
          </label>
        </div>

        {showDisabledState ? (
          <StatePanel kind="disabled" onAction={() => setShowDisabledState(false)} />
        ) : (
          <div className="endpoint-grid">
            {endpointFixtures.map((endpoint) => (
              <article className="panel endpoint-card" key={endpoint.id}>
                <div className="endpoint-card__header">
                  <div>
                    <h2>{endpoint.name}</h2>
                    <code>{endpoint.url}</code>
                  </div>

                  <StatusBadge status={endpoint.status} />
                </div>

                <div className="endpoint-metrics">
                  <div>
                    <span>Success rate</span>
                    <strong>{endpoint.successRate.toFixed(2)}%</strong>
                  </div>
                  <div>
                    <span>Average latency</span>
                    <strong>{formatLatency(endpoint.averageLatencyMs)}</strong>
                  </div>
                  <div>
                    <span>Events · 24h</span>
                    <strong>{formatNumber(endpoint.eventCount24h)}</strong>
                  </div>
                  <div>
                    <span>Last delivery</span>
                    <strong>{formatTimestamp(endpoint.lastDeliveryAt)}</strong>
                  </div>
                </div>

                <div className="endpoint-card__footer">
                  <div>
                    <span>Signing secret</span>
                    <code>{endpoint.signingSecretHint}</code>
                  </div>

                  <button className="secondary-button" type="button">
                    Configure
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
