import { StatusBadge } from '../components/StatusBadge'
import { endpointFixtures } from '../data/endpoints'
import { eventFixtures } from '../data/events'
import { formatLatency, formatTimestamp } from '../data/formatters'

export function OverviewPage() {
  const recentEvents = eventFixtures.slice(0, 3)

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Operations overview</p>
          <h1>Delivery control plane</h1>
          <p className="page-header__description">
            Monitor webhook throughput, delivery health, retries, and destination reliability from
            one place.
          </p>
        </div>

        <button className="primary-button" type="button">
          Send test event
        </button>
      </header>

      <div className="overview-metrics">
        <article className="panel">
          <span>Events · 24h</span>
          <strong>17,447</strong>
          <small>Across 3 configured endpoints</small>
        </article>

        <article className="panel">
          <span>Delivered</span>
          <strong>17,425</strong>
          <small>99.87% successful</small>
        </article>

        <article className="panel">
          <span>Retrying</span>
          <strong>18</strong>
          <small>Oldest retry scheduled in 4m</small>
        </article>

        <article className="panel">
          <span>Median latency</span>
          <strong>184 ms</strong>
          <small>Outbound requests</small>
        </article>
      </div>

      <div className="overview-layout">
        <article className="panel">
          <div className="panel__header">
            <div>
              <h2>Recent activity</h2>
              <p>Latest delivery lifecycle changes</p>
            </div>
          </div>

          <div className="overview-event-list">
            {recentEvents.map((event) => (
              <div className="overview-event-row" key={event.id}>
                <div>
                  <strong>{event.eventType}</strong>
                  <span>{event.endpointName}</span>
                </div>

                <StatusBadge status={event.status} />

                <time>{formatTimestamp(event.createdAt)}</time>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel__header">
            <div>
              <h2>Endpoint health</h2>
              <p>Current destination performance</p>
            </div>
          </div>

          <div className="overview-endpoint-list">
            {endpointFixtures.map((endpoint) => (
              <div className="overview-endpoint-row" key={endpoint.id}>
                <div>
                  <strong>{endpoint.name}</strong>
                  <span>{formatLatency(endpoint.averageLatencyMs)} average</span>
                </div>

                <StatusBadge status={endpoint.status} />
              </div>
            ))}
          </div>
        </article>
      </div>
    </section>
  )
}
