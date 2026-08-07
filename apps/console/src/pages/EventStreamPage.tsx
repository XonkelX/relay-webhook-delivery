import type { EventListResponse } from '@relay/contracts'
import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { StatusBadge } from '../components/StatusBadge'
import { formatNumber, formatTimestamp } from '../data/formatters'
import { getEvents } from '../lib/owner-api'

const deliveryStatuses = [
  'queued',
  'leased',
  'retrying',
  'delivered',
  'exhausted',
  'cancelled',
] as const

type DeliveryFilterStatus = (typeof deliveryStatuses)[number]

interface EventFilters {
  eventType: string
  status: '' | DeliveryFilterStatus
}

const emptyFilters: EventFilters = {
  eventType: '',
  status: '',
}

function formatSuccessRate(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(2)}%`
}

export function EventStreamPage() {
  const [result, setResult] = useState<EventListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [eventTypeInput, setEventTypeInput] = useState('')
  const [statusInput, setStatusInput] = useState<'' | DeliveryFilterStatus>('')

  const [filters, setFilters] = useState<EventFilters>(emptyFilters)
  const [cursor, setCursor] = useState<string | null>(null)
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([])

  const loadEvents = useCallback(async () => {
    setLoading(true)
    setError(null)

    const params = new URLSearchParams({
      limit: '50',
    })

    if (filters.eventType) {
      params.set('eventType', filters.eventType)
    }

    if (filters.status) {
      params.set('status', filters.status)
    }

    if (cursor) {
      params.set('cursor', cursor)
    }

    try {
      setResult(await getEvents(params.toString()))
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : 'The event stream could not be loaded.',
      )
    } finally {
      setLoading(false)
    }
  }, [cursor, filters])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadEvents()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [loadEvents])

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    setCursor(null)
    setCursorHistory([])
    setFilters({
      eventType: eventTypeInput.trim(),
      status: statusInput,
    })
  }

  function clearFilters() {
    setEventTypeInput('')
    setStatusInput('')
    setCursor(null)
    setCursorHistory([])
    setFilters(emptyFilters)
  }

  function nextPage() {
    if (!result?.nextCursor) {
      return
    }

    setCursorHistory((history) => [...history, cursor])
    setCursor(result.nextCursor)
  }

  function previousPage() {
    if (cursorHistory.length === 0) {
      return
    }

    const previousCursor = cursorHistory.at(-1) ?? null

    setCursorHistory((history) => history.slice(0, -1))
    setCursor(previousCursor)
  }

  return (
    <section className="page" aria-busy={loading}>
      <header className="page-header">
        <div>
          <p className="eyebrow">Operations</p>
          <h1>Event stream</h1>
          <p className="page-header__description">
            Inspect accepted webhook events, aggregate fanout state, and delivery outcomes from the
            durable event log.
          </p>
        </div>
      </header>

      {result ? (
        <div className="metric-strip event-stream-metrics" aria-label="Event summary">
          <div>
            <span>Events · 24h</span>
            <strong>{formatNumber(result.metrics.events24h)}</strong>
          </div>

          <div>
            <span>Delivered · 24h</span>
            <strong>{formatNumber(result.metrics.deliveredDeliveries24h)}</strong>
          </div>

          <div>
            <span>Retrying now</span>
            <strong>{formatNumber(result.metrics.retryingDeliveriesNow)}</strong>
          </div>

          <div>
            <span>Exhausted · 24h</span>
            <strong>{formatNumber(result.metrics.exhaustedDeliveries24h)}</strong>
          </div>

          <div>
            <span>Success rate</span>
            <strong>{formatSuccessRate(result.metrics.successRate24h)}</strong>
          </div>
        </div>
      ) : null}

      <div className="panel">
        <div className="panel__header">
          <div>
            <h2>Recent events</h2>
            <p>Newest first · cursor-paginated</p>
          </div>
        </div>

        <form className="event-stream-controls" onSubmit={applyFilters}>
          <label>
            <span>Event type</span>
            <input
              type="text"
              value={eventTypeInput}
              placeholder="invoice.created"
              onChange={(event) => setEventTypeInput(event.target.value)}
            />
          </label>

          <label>
            <span>Delivery status</span>
            <select
              value={statusInput}
              onChange={(event) => setStatusInput(event.target.value as '' | DeliveryFilterStatus)}
            >
              <option value="">All statuses</option>

              {deliveryStatuses.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>

          <div className="event-stream-controls__actions">
            <button className="primary-button" type="submit" disabled={loading}>
              Apply filters
            </button>

            <button
              className="secondary-button"
              type="button"
              disabled={loading}
              onClick={clearFilters}
            >
              Clear
            </button>
          </div>
        </form>

        {error ? (
          <div className="operational-state" role="alert">
            <h2>Event stream unavailable</h2>
            <p>{error}</p>

            <button className="secondary-button" type="button" onClick={() => void loadEvents()}>
              Retry
            </button>
          </div>
        ) : null}

        {loading && !result ? (
          <div className="operational-state" aria-live="polite">
            <h2>Loading events</h2>
            <p>Reading the durable event stream.</p>
          </div>
        ) : null}

        {result && result.items.length === 0 ? (
          <div className="operational-state">
            <h2>No matching events</h2>
            <p>No accepted events match the current filters.</p>
          </div>
        ) : null}

        {result && result.items.length > 0 ? (
          <>
            <div className="table-scroll">
              <table className="event-table">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Status</th>
                    <th>Fanout</th>
                    <th>Payload</th>
                    <th>Created</th>
                  </tr>
                </thead>

                <tbody>
                  {result.items.map((event) => (
                    <tr key={event.id}>
                      <td>
                        <Link className="event-link" to={`/console/events/${event.id}`}>
                          <strong>{event.eventType}</strong>
                          <code>{event.id}</code>
                        </Link>
                      </td>

                      <td>
                        <StatusBadge status={event.status} />
                      </td>

                      <td>
                        <strong>
                          {formatNumber(event.deliveries.delivered)}/
                          {formatNumber(event.deliveries.total)} delivered
                        </strong>
                        <span>
                          {formatNumber(event.deliveries.retrying)} retrying ·{' '}
                          {formatNumber(event.deliveries.exhausted)} exhausted
                        </span>
                      </td>

                      <td>{formatNumber(event.payloadBytes)} B</td>

                      <td>{formatTimestamp(event.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="event-stream-pagination">
              <span>Page {formatNumber(cursorHistory.length + 1)}</span>

              <div>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={loading || cursorHistory.length === 0}
                  onClick={previousPage}
                >
                  Previous
                </button>

                <button
                  className="secondary-button"
                  type="button"
                  disabled={loading || !result.nextCursor}
                  onClick={nextPage}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </section>
  )
}
