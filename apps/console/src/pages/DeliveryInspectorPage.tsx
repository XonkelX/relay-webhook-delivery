import { StatusBadge } from '../components/StatusBadge'
import type { EventFixture } from '../data/types'
import { formatLatency, formatTimestamp } from '../data/formatters'

interface DeliveryInspectorPageProps {
  event: EventFixture
  onBack: () => void
}

export function DeliveryInspectorPage({ event, onBack }: DeliveryInspectorPageProps) {
  return (
    <section className="page">
      <button className="back-button" type="button" onClick={onBack}>
        ← Back to event stream
      </button>

      <header className="page-header inspector-header">
        <div>
          <p className="eyebrow">Delivery inspector</p>
          <h1>{event.eventType}</h1>
          <p className="page-header__description">
            Inspect every delivery attempt and the current lifecycle state.
          </p>
        </div>

        <div className="inspector-header__actions">
          <StatusBadge status={event.status} />
          <button className="primary-button" type="button">
            Replay event
          </button>
        </div>
      </header>

      <div className="inspector-grid">
        <article className="panel detail-panel">
          <div className="panel__header">
            <div>
              <h2>Delivery details</h2>
              <p>Canonical identifiers and destination metadata</p>
            </div>
          </div>

          <dl className="detail-list">
            <div>
              <dt>Event ID</dt>
              <dd>
                <code>{event.id}</code>
              </dd>
            </div>
            <div>
              <dt>Delivery ID</dt>
              <dd>
                <code>{event.deliveryId}</code>
              </dd>
            </div>
            <div>
              <dt>Webhook ID</dt>
              <dd>
                <code>{event.webhookId}</code>
              </dd>
            </div>
            <div>
              <dt>Endpoint</dt>
              <dd>{event.endpointName}</dd>
            </div>
            <div>
              <dt>Destination</dt>
              <dd>
                <code>{event.endpointUrl}</code>
              </dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{formatTimestamp(event.createdAt)}</dd>
            </div>
            {event.nextRetryAt && (
              <div>
                <dt>Next retry</dt>
                <dd>{formatTimestamp(event.nextRetryAt)}</dd>
              </div>
            )}
            {event.replayOf && (
              <div>
                <dt>Replay of</dt>
                <dd>
                  <code>{event.replayOf}</code>
                </dd>
              </div>
            )}
          </dl>
        </article>

        <article className="panel attempt-panel">
          <div className="panel__header">
            <div>
              <h2>Attempt timeline</h2>
              <p>{event.attemptCount} recorded attempt(s)</p>
            </div>
          </div>

          <ol className="attempt-list">
            {event.attempts.map((attempt) => (
              <li key={attempt.id} className="attempt-item">
                <span
                  className={`attempt-marker attempt-marker--${attempt.outcome}`}
                  aria-hidden="true"
                />

                <div className="attempt-item__content">
                  <div className="attempt-item__header">
                    <strong>Attempt {attempt.number}</strong>
                    <time>{formatTimestamp(attempt.occurredAt)}</time>
                  </div>

                  <div className="attempt-facts">
                    <span>
                      HTTP{' '}
                      <strong>
                        {attempt.statusCode === null ? 'No response' : attempt.statusCode}
                      </strong>
                    </span>
                    <span>
                      Latency <strong>{formatLatency(attempt.latencyMs)}</strong>
                    </span>
                    <span>
                      Outcome <strong>{attempt.outcome.replaceAll('_', ' ')}</strong>
                    </span>
                  </div>

                  {attempt.errorClass && (
                    <code className="attempt-error">{attempt.errorClass}</code>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </article>
      </div>
    </section>
  )
}
