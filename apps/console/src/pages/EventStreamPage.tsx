import { useState } from 'react'
import { StatePanel } from '../components/StatePanel'
import { StatusBadge } from '../components/StatusBadge'
import { eventFixtures } from '../data/events'
import { formatTimestamp } from '../data/formatters'
import type { EventFixture } from '../data/types'
import type { UiStateKind } from '../data/uiStates'

type EventStreamPreview = 'live' | Exclude<UiStateKind, 'disabled'>

interface EventStreamPageProps {
  onSelectEvent: (event: EventFixture) => void
}

export function EventStreamPage({ onSelectEvent }: EventStreamPageProps) {
  const [previewState, setPreviewState] = useState<EventStreamPreview>('live')

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Operations</p>
          <h1>Event stream</h1>
          <p className="page-header__description">
            Inspect the current lifecycle of every outbound webhook event.
          </p>
        </div>

        <button className="primary-button" type="button">
          Send test event
        </button>
      </header>

      <div className="metric-strip" aria-label="Event summary">
        <div>
          <span>Delivered</span>
          <strong>12,842</strong>
        </div>
        <div>
          <span>Retrying</span>
          <strong>18</strong>
        </div>
        <div>
          <span>Exhausted</span>
          <strong>4</strong>
        </div>
        <div>
          <span>Success rate</span>
          <strong>99.94%</strong>
        </div>
      </div>

      <div className="panel">
        <div className="panel__header">
          <div>
            <h2>Recent events</h2>
            <p>Deterministic Phase 1 fixture data</p>
          </div>

          <label className="state-preview-control">
            <span>Preview state</span>
            <select
              value={previewState}
              onChange={(event) => setPreviewState(event.target.value as EventStreamPreview)}
            >
              <option value="live">Live data</option>
              <option value="empty">Empty</option>
              <option value="loading">Loading</option>
              <option value="error">Error</option>
              <option value="quota">Quota reached</option>
            </select>
          </label>
        </div>

        {previewState === 'live' ? (
          <div className="table-scroll">
            <table className="event-table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Endpoint</th>
                  <th>Status</th>
                  <th>Attempts</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {eventFixtures.map((event) => (
                  <tr key={event.id}>
                    <td>
                      <button
                        className="event-link"
                        type="button"
                        onClick={() => onSelectEvent(event)}
                      >
                        <strong>{event.eventType}</strong>
                        <code>{event.id}</code>
                      </button>
                    </td>
                    <td>
                      <strong>{event.endpointName}</strong>
                      <span>{event.endpointUrl}</span>
                    </td>
                    <td>
                      <StatusBadge status={event.status} />
                    </td>
                    <td>{event.attemptCount}</td>
                    <td>{formatTimestamp(event.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <StatePanel kind={previewState} onAction={() => setPreviewState('live')} />
        )}
      </div>
    </section>
  )
}
