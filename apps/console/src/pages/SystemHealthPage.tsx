import type { SystemHealthResponse } from '@relay/contracts'
import { useCallback, useEffect, useState } from 'react'
import { formatLatency, formatNumber, formatTimestamp } from '../data/formatters'
import { getSystemHealth } from '../lib/owner-api'

function formatRate(value: number | null) {
  return value === null ? '—' : `${value.toFixed(2)}%`
}

function formatOptionalTimestamp(value: string | null) {
  return value === null ? 'None' : formatTimestamp(value)
}

function formatBytes(value: number) {
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MiB`
  }

  if (value >= 1024) {
    return `${(value / 1024).toFixed(0)} KiB`
  }

  return `${value} B`
}

function quotaPercent(health: SystemHealthResponse) {
  const { globalAcceptedEventsToday, globalDailyEventLimit } = health.quotas

  if (globalDailyEventLimit === 0) {
    return 0
  }

  return Math.min(100, (globalAcceptedEventsToday / globalDailyEventLimit) * 100)
}

export function SystemHealthPage() {
  const [health, setHealth] = useState<SystemHealthResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadHealth = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      setHealth(await getSystemHealth())
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : 'System health could not be loaded.',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadHealth()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [loadHealth])

  return (
    <section className="page" aria-busy={loading}>
      <header className="page-header">
        <div>
          <p className="eyebrow">Reliability</p>
          <h1>System health</h1>
          <p className="page-header__description">
            Review durable queue pressure, retry state, outbox backlog, ingestion quotas, and the
            guardrails enforced by Relay.
          </p>
        </div>

        <button
          className="secondary-button"
          type="button"
          disabled={loading}
          onClick={() => void loadHealth()}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      {loading && !health ? (
        <article className="panel operational-state" aria-live="polite">
          <h2>Loading health telemetry</h2>
          <p>Reading current operational state from Relay.</p>
        </article>
      ) : null}

      {error ? (
        <article className="panel operational-state" role="alert">
          <h2>Health telemetry unavailable</h2>
          <p>{error}</p>

          <button className="secondary-button" type="button" onClick={() => void loadHealth()}>
            Retry
          </button>
        </article>
      ) : null}

      {health ? (
        <>
          <div className="health-metrics">
            <article className="panel">
              <span>Queued deliveries</span>
              <strong>{formatNumber(health.queuedDeliveries)}</strong>
              <small>Oldest: {formatOptionalTimestamp(health.oldestQueuedAt)}</small>
            </article>

            <article className="panel">
              <span>Retrying deliveries</span>
              <strong>{formatNumber(health.retryingDeliveries)}</strong>
              <small>Oldest retry: {formatOptionalTimestamp(health.oldestRetryAt)}</small>
            </article>

            <article className="panel">
              <span>Success rate · 24h</span>
              <strong>{formatRate(health.successRate24h)}</strong>
              <small>Terminal delivery outcomes</small>
            </article>

            <article className="panel">
              <span>Median latency · 24h</span>
              <strong>
                {health.medianLatencyMs24h === null
                  ? '—'
                  : formatLatency(health.medianLatencyMs24h)}
              </strong>
              <small>Completed delivery attempts</small>
            </article>
          </div>

          <div className="health-layout">
            <article className="panel">
              <div className="panel__header">
                <div>
                  <h2>Operational pressure</h2>
                  <p>Current durable work waiting inside Relay</p>
                </div>
              </div>

              <dl className="health-pressure-list">
                <div>
                  <dt>Queued deliveries</dt>
                  <dd>
                    <strong>{formatNumber(health.queuedDeliveries)}</strong>
                    <span>Oldest created {formatOptionalTimestamp(health.oldestQueuedAt)}</span>
                  </dd>
                </div>

                <div>
                  <dt>Retrying deliveries</dt>
                  <dd>
                    <strong>{formatNumber(health.retryingDeliveries)}</strong>
                    <span>Oldest retry due {formatOptionalTimestamp(health.oldestRetryAt)}</span>
                  </dd>
                </div>

                <div>
                  <dt>Due outbox records</dt>
                  <dd>
                    <strong>{formatNumber(health.pendingOutbox)}</strong>
                    <span>
                      Oldest available {formatOptionalTimestamp(health.oldestPendingOutboxAt)}
                    </span>
                  </dd>
                </div>
              </dl>
            </article>

            <article className="panel">
              <div className="panel__header">
                <div>
                  <h2>Ingestion quota</h2>
                  <p>Current UTC-day event budget</p>
                </div>
              </div>

              <div className="quota-panel">
                <div className="quota-panel__summary">
                  <strong>{formatNumber(health.quotas.globalAcceptedEventsToday)}</strong>
                  <span>
                    of {formatNumber(health.quotas.globalDailyEventLimit)} global events accepted
                    today
                  </span>
                </div>

                <div
                  className="quota-meter"
                  role="progressbar"
                  aria-label="Global daily event quota"
                  aria-valuemin={0}
                  aria-valuemax={health.quotas.globalDailyEventLimit}
                  aria-valuenow={health.quotas.globalAcceptedEventsToday}
                >
                  <span style={{ width: `${quotaPercent(health)}%` }} />
                </div>

                <dl className="quota-facts">
                  <div>
                    <dt>Global daily limit</dt>
                    <dd>{formatNumber(health.quotas.globalDailyEventLimit)}</dd>
                  </div>
                  <div>
                    <dt>Per-key daily limit</dt>
                    <dd>{formatNumber(health.quotas.perKeyDailyEventLimit)}</dd>
                  </div>
                  <div>
                    <dt>Budget used</dt>
                    <dd>{quotaPercent(health).toFixed(1)}%</dd>
                  </div>
                </dl>
              </div>
            </article>
          </div>

          <article className="panel guardrail-panel health-guardrails">
            <div className="panel__header">
              <div>
                <h2>Operational guardrails</h2>
                <p>Runtime values sourced from the canonical project configuration</p>
              </div>
            </div>

            <dl className="guardrail-list">
              <div>
                <dt>Scheduler interval</dt>
                <dd>{health.guardrails.schedulerIntervalSeconds} seconds</dd>
              </div>

              <div>
                <dt>Claims per tick</dt>
                <dd>{formatNumber(health.guardrails.claimsPerTick)} maximum</dd>
              </div>

              <div>
                <dt>Daily claims</dt>
                <dd>{formatNumber(health.guardrails.maxDailyClaims)} maximum</dd>
              </div>

              <div>
                <dt>Delivery attempts</dt>
                <dd>{health.guardrails.maxDeliveryAttempts} maximum</dd>
              </div>

              <div>
                <dt>Request timeout</dt>
                <dd>{formatLatency(health.guardrails.requestTimeoutMs)}</dd>
              </div>

              <div>
                <dt>Payload size</dt>
                <dd>{formatBytes(health.guardrails.maxPayloadBytes)}</dd>
              </div>

              <div>
                <dt>Response capture</dt>
                <dd>{formatBytes(health.guardrails.maxResponseCaptureBytes)}</dd>
              </div>

              <div>
                <dt>Event retention</dt>
                <dd>{health.guardrails.eventRetentionDays} days</dd>
              </div>

              <div>
                <dt>Attempt retention</dt>
                <dd>{health.guardrails.attemptRetentionDays} days</dd>
              </div>
            </dl>
          </article>
        </>
      ) : null}
    </section>
  )
}
