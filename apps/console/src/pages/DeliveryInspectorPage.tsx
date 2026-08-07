import type { EventDetailResponse } from '@relay/contracts'
import { useCallback, useEffect, useState } from 'react'
import { StatusBadge } from '../components/StatusBadge'
import { formatLatency, formatTimestamp } from '../data/formatters'
import { getEvent, replayDelivery } from '../lib/owner-api'

type DeliveryDetail = EventDetailResponse['deliveries'][number]

interface DeliveryInspectorPageProps {
  eventId: string
  onBack: () => void
}

function isReplayable(delivery: DeliveryDetail) {
  return (
    (delivery.status === 'delivered' ||
      delivery.status === 'exhausted' ||
      delivery.status === 'cancelled') &&
    delivery.endpoint.status === 'active'
  )
}

export function DeliveryInspectorPage({ eventId, onBack }: DeliveryInspectorPageProps) {
  const [detail, setDetail] = useState<EventDetailResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [replayingId, setReplayingId] = useState<string | null>(null)
  const [replayMessage, setReplayMessage] = useState<string | null>(null)

  const loadDetail = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      setDetail(await getEvent(eventId))
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : 'The event detail could not be loaded.',
      )
    } finally {
      setLoading(false)
    }
  }, [eventId])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadDetail()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [loadDetail])

  async function handleReplay(delivery: DeliveryDetail) {
    if (replayingId || !isReplayable(delivery)) return

    setReplayingId(delivery.id)
    setReplayMessage(null)

    try {
      const replay = await replayDelivery(delivery.id)
      setReplayMessage(`Replay ${replay.deliveryId} was queued.`)
      await loadDetail()
    } catch (replayError) {
      setReplayMessage(
        replayError instanceof Error ? replayError.message : 'The delivery could not be replayed.',
      )
    } finally {
      setReplayingId(null)
    }
  }

  return (
    <section className="page" aria-busy={loading}>
      <button className="back-button" type="button" onClick={onBack}>
        ← Back to event stream
      </button>

      {loading && !detail ? (
        <article className="panel operational-state" aria-live="polite">
          <h2>Loading event</h2>
          <p>Reading persisted delivery and attempt evidence.</p>
        </article>
      ) : null}

      {error ? (
        <article className="panel operational-state" role="alert">
          <h2>Event unavailable</h2>
          <p>{error}</p>
          <button className="secondary-button" type="button" onClick={() => void loadDetail()}>
            Retry
          </button>
        </article>
      ) : null}

      {detail ? (
        <>
          <header className="page-header inspector-header">
            <div>
              <p className="eyebrow">Delivery inspector</p>
              <h1>{detail.event.eventType}</h1>
              <p className="page-header__description">
                Inspect every fanout delivery, attempt, endpoint, and replay relationship.
              </p>
            </div>

            <StatusBadge status={detail.event.status} />
          </header>

          <article className="panel event-detail-summary">
            <div className="panel__header">
              <div>
                <h2>Event</h2>
                <p>Durable event metadata and aggregate fanout state</p>
              </div>
            </div>

            <dl className="detail-list">
              <div>
                <dt>Event ID</dt>
                <dd>
                  <code>{detail.event.id}</code>
                </dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{formatTimestamp(detail.event.createdAt)}</dd>
              </div>
              <div>
                <dt>Payload</dt>
                <dd>{detail.event.payloadBytes} B</dd>
              </div>
              <div>
                <dt>Deliveries</dt>
                <dd>
                  {detail.event.deliveries.delivered}/{detail.event.deliveries.total} delivered ·{' '}
                  {detail.event.deliveries.retrying} retrying · {detail.event.deliveries.exhausted}{' '}
                  exhausted
                </dd>
              </div>
            </dl>
          </article>

          {replayMessage ? (
            <p className="inspector-message" aria-live="polite">
              {replayMessage}
            </p>
          ) : null}

          <div className="delivery-inspector-list">
            {detail.deliveries.length === 0 ? (
              <article className="panel operational-state">
                <h2>No deliveries</h2>
                <p>This event did not generate any endpoint deliveries.</p>
              </article>
            ) : (
              detail.deliveries.map((delivery) => (
                <article className="panel delivery-inspector" key={delivery.id}>
                  <div className="delivery-inspector__header">
                    <div>
                      <p className="eyebrow">Delivery</p>
                      <h2>{delivery.endpoint.name}</h2>
                      <code>{delivery.id}</code>
                    </div>

                    <div className="inspector-header__actions">
                      <StatusBadge status={delivery.status} />

                      <button
                        className="secondary-button"
                        type="button"
                        disabled={replayingId !== null || !isReplayable(delivery)}
                        onClick={() => void handleReplay(delivery)}
                      >
                        {replayingId === delivery.id ? 'Queuing…' : 'Replay delivery'}
                      </button>
                    </div>
                  </div>

                  <div className="inspector-grid">
                    <section>
                      <div className="panel__header">
                        <div>
                          <h2>Delivery details</h2>
                          <p>Destination and lifecycle metadata</p>
                        </div>
                      </div>

                      <dl className="detail-list">
                        <div>
                          <dt>Destination</dt>
                          <dd>
                            <code>{delivery.endpoint.url}</code>
                          </dd>
                        </div>
                        <div>
                          <dt>Endpoint</dt>
                          <dd>
                            <StatusBadge status={delivery.endpoint.status} />
                          </dd>
                        </div>
                        <div>
                          <dt>Attempts</dt>
                          <dd>{delivery.attemptCount}</dd>
                        </div>
                        <div>
                          <dt>Created</dt>
                          <dd>{formatTimestamp(delivery.createdAt)}</dd>
                        </div>

                        {delivery.nextAttemptAt ? (
                          <div>
                            <dt>Next attempt</dt>
                            <dd>{formatTimestamp(delivery.nextAttemptAt)}</dd>
                          </div>
                        ) : null}

                        {delivery.replayOfDeliveryId ? (
                          <div>
                            <dt>Replay of</dt>
                            <dd>
                              <code>{delivery.replayOfDeliveryId}</code>
                            </dd>
                          </div>
                        ) : null}

                        {delivery.lastErrorClass ? (
                          <div>
                            <dt>Last error</dt>
                            <dd>
                              <code>{delivery.lastErrorClass}</code>
                            </dd>
                          </div>
                        ) : null}
                      </dl>
                    </section>

                    <section>
                      <div className="panel__header">
                        <div>
                          <h2>Attempt timeline</h2>
                          <p>{delivery.attempts.length} persisted attempt(s)</p>
                        </div>
                      </div>

                      {delivery.attempts.length === 0 ? (
                        <p className="overview-empty">No attempts have been recorded yet.</p>
                      ) : (
                        <ol className="attempt-list">
                          {delivery.attempts.map((attempt) => {
                            const occurredAt = attempt.completedAt ?? attempt.requestStartedAt

                            return (
                              <li key={attempt.id} className="attempt-item">
                                <span
                                  className={`attempt-marker attempt-marker--${
                                    attempt.outcome ?? attempt.state
                                  }`}
                                  aria-hidden="true"
                                />

                                <div className="attempt-item__content">
                                  <div className="attempt-item__header">
                                    <strong>Attempt {attempt.number}</strong>
                                    {occurredAt ? <time>{formatTimestamp(occurredAt)}</time> : null}
                                  </div>

                                  <div className="attempt-facts">
                                    <span>
                                      HTTP <strong>{attempt.statusCode ?? 'No response'}</strong>
                                    </span>
                                    <span>
                                      Latency{' '}
                                      <strong>
                                        {attempt.latencyMs === null
                                          ? '—'
                                          : formatLatency(attempt.latencyMs)}
                                      </strong>
                                    </span>
                                    <span>
                                      Outcome{' '}
                                      <strong>
                                        {attempt.outcome?.replaceAll('_', ' ') ?? attempt.state}
                                      </strong>
                                    </span>
                                  </div>

                                  {attempt.webhookId ? (
                                    <code className="attempt-evidence">
                                      Webhook ID: {attempt.webhookId}
                                    </code>
                                  ) : null}

                                  {attempt.errorClass ? (
                                    <code className="attempt-error">{attempt.errorClass}</code>
                                  ) : null}

                                  {attempt.responseExcerpt ? (
                                    <pre className="attempt-response">
                                      {attempt.responseExcerpt}
                                    </pre>
                                  ) : null}
                                </div>
                              </li>
                            )
                          })}
                        </ol>
                      )}
                    </section>
                  </div>
                </article>
              ))
            )}
          </div>
        </>
      ) : null}
    </section>
  )
}
