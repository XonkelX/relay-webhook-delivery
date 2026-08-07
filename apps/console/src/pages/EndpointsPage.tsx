import type { EndpointListResponse } from '@relay/contracts'
import { useCallback, useEffect, useState } from 'react'
import { StatusBadge } from '../components/StatusBadge'
import { formatLatency, formatNumber, formatTimestamp } from '../data/formatters'
import {
  getEndpoints,
  rotateOwnerEndpointSecret,
  setEndpointStatus,
  updateEndpointSubscriptions,
  verifyOwnerEndpoint,
} from '../lib/owner-api'

type EndpointSummary = EndpointListResponse['items'][number]

interface RevealedSecret {
  endpointId: string
  endpointName: string
  signingSecret: string
  generation: number
  previousSecretValidUntil: string
}

function formatRate(value: number | null) {
  return value === null ? '—' : `${value.toFixed(2)}%`
}

function formatFailureRate(value: number | null) {
  return value === null ? '—' : `${(100 - value).toFixed(2)}%`
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

function parseSubscriptions(value: string) {
  return [
    ...new Set(
      value
        .split(/[\n,]+/)
        .map((eventType) => eventType.trim())
        .filter(Boolean),
    ),
  ].sort()
}

export function EndpointsPage() {
  const [result, setResult] = useState<EndpointListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [subscriptionDrafts, setSubscriptionDrafts] = useState<Record<string, string>>({})
  const [revealedSecret, setRevealedSecret] = useState<RevealedSecret | null>(null)

  const loadEndpoints = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const next = await getEndpoints()

      setResult(next)

      setSubscriptionDrafts(
        Object.fromEntries(
          next.items.map((endpoint) => [endpoint.id, endpoint.subscriptions.join('\n')]),
        ),
      )
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

  async function runMutation(key: string, action: () => Promise<void>) {
    if (busyAction !== null) return

    setBusyAction(key)
    setMessage(null)

    try {
      await action()
    } catch (mutationError) {
      setMessage(
        mutationError instanceof Error
          ? mutationError.message
          : 'The endpoint operation could not be completed.',
      )
    } finally {
      setBusyAction(null)
    }
  }

  function handleStatus(endpoint: EndpointSummary, status: 'active' | 'paused') {
    void runMutation(`${endpoint.id}:status`, async () => {
      await setEndpointStatus(endpoint.id, status)
      await loadEndpoints()

      setMessage(
        status === 'paused' ? `${endpoint.name} is paused.` : `${endpoint.name} is active again.`,
      )
    })
  }

  function handleVerification(endpoint: EndpointSummary) {
    void runMutation(`${endpoint.id}:verify`, async () => {
      await verifyOwnerEndpoint(endpoint.id)
      await loadEndpoints()

      setMessage(`${endpoint.name} was verified and activated.`)
    })
  }

  function handleSubscriptions(endpoint: EndpointSummary) {
    void runMutation(`${endpoint.id}:subscriptions`, async () => {
      const eventTypes = parseSubscriptions(subscriptionDrafts[endpoint.id] ?? '')

      await updateEndpointSubscriptions(endpoint.id, eventTypes)

      await loadEndpoints()

      setMessage(`${endpoint.name} subscriptions were updated.`)
    })
  }

  function handleRotation(endpoint: EndpointSummary) {
    const confirmed = window.confirm(
      `Rotate the signing secret for ${endpoint.name}? ` +
        'The new secret will be shown only once. The previous secret remains valid during the grace window.',
    )

    if (!confirmed) return

    void runMutation(`${endpoint.id}:rotation`, async () => {
      const rotated = await rotateOwnerEndpointSecret(endpoint.id)

      setRevealedSecret({
        endpointId: endpoint.id,
        endpointName: endpoint.name,
        signingSecret: rotated.signingSecret,
        generation: rotated.generation,
        previousSecretValidUntil: rotated.previousSecretValidUntil,
      })

      await loadEndpoints()

      setMessage(`${endpoint.name} signing secret rotated to generation ${rotated.generation}.`)
    })
  }

  async function copyRevealedSecret() {
    if (!revealedSecret) return

    try {
      await navigator.clipboard.writeText(revealedSecret.signingSecret)

      setMessage('The new signing secret was copied.')
    } catch {
      setMessage('The browser could not copy the secret. Copy it manually before dismissing it.')
    }
  }

  return (
    <section className="page" aria-busy={loading}>
      <header className="page-header">
        <div>
          <p className="eyebrow">Destinations</p>
          <h1>Endpoints</h1>
          <p className="page-header__description">
            Verify destinations, pause delivery, rotate signing secrets, manage subscriptions, and
            inspect recent delivery health.
          </p>
        </div>

        <button
          className="secondary-button"
          type="button"
          disabled={loading || busyAction !== null}
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

      {message ? (
        <p className="inspector-message" aria-live="polite">
          {message}
        </p>
      ) : null}

      {revealedSecret ? (
        <article className="panel endpoint-secret-reveal" role="alert">
          <div>
            <p className="eyebrow">New signing secret</p>
            <h2>{revealedSecret.endpointName}</h2>
            <p>
              Generation {revealedSecret.generation}. Copy this value now. Relay will not reveal it
              again after this notice is dismissed or the page is reloaded.
            </p>
          </div>

          <code>{revealedSecret.signingSecret}</code>

          <p>
            Previous generation remains valid until{' '}
            {formatTimestamp(revealedSecret.previousSecretValidUntil)}.
          </p>

          <div className="endpoint-management__actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => void copyRevealedSecret()}
            >
              Copy new secret
            </button>

            <button
              className="secondary-button"
              type="button"
              onClick={() => setRevealedSecret(null)}
            >
              Dismiss
            </button>
          </div>
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
          {result.items.map((endpoint) => {
            const statusBusy = busyAction === `${endpoint.id}:status`
            const verifyBusy = busyAction === `${endpoint.id}:verify`
            const rotationBusy = busyAction === `${endpoint.id}:rotation`
            const subscriptionsBusy = busyAction === `${endpoint.id}:subscriptions`

            return (
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
                    <span>Failure rate · 24h</span>
                    <strong>{formatFailureRate(endpoint.successRate24h)}</strong>
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

                <section className="endpoint-management">
                  <div className="endpoint-management__header">
                    <div>
                      <h3>Endpoint controls</h3>
                      <p>State changes apply to production delivery behavior.</p>
                    </div>
                  </div>

                  <div className="endpoint-management__actions">
                    {endpoint.status === 'pending' ? (
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={busyAction !== null}
                        onClick={() => handleVerification(endpoint)}
                      >
                        {verifyBusy ? 'Verifying…' : 'Verify endpoint'}
                      </button>
                    ) : null}

                    {endpoint.status === 'active' ? (
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={busyAction !== null}
                        onClick={() => handleStatus(endpoint, 'paused')}
                      >
                        {statusBusy ? 'Pausing…' : 'Pause delivery'}
                      </button>
                    ) : null}

                    {endpoint.status === 'paused' ? (
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={busyAction !== null}
                        onClick={() => handleStatus(endpoint, 'active')}
                      >
                        {statusBusy ? 'Resuming…' : 'Resume delivery'}
                      </button>
                    ) : null}

                    {endpoint.secretGeneration !== null ? (
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={busyAction !== null}
                        onClick={() => handleRotation(endpoint)}
                      >
                        {rotationBusy ? 'Rotating…' : 'Rotate signing secret'}
                      </button>
                    ) : null}
                  </div>

                  {endpoint.status === 'disabled' ? (
                    <p className="endpoint-management__note">
                      This endpoint is disabled. Delivery cannot be resumed from this screen.
                    </p>
                  ) : null}

                  <label className="endpoint-subscription-editor">
                    <span>Event subscriptions</span>
                    <textarea
                      rows={4}
                      value={subscriptionDrafts[endpoint.id] ?? ''}
                      disabled={busyAction !== null}
                      onChange={(event) =>
                        setSubscriptionDrafts((current) => ({
                          ...current,
                          [endpoint.id]: event.target.value,
                        }))
                      }
                      placeholder={'invoice.paid\ninvoice.payment_failed'}
                    />
                  </label>

                  <button
                    className="secondary-button"
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => handleSubscriptions(endpoint)}
                  >
                    {subscriptionsBusy ? 'Saving…' : 'Save subscriptions'}
                  </button>
                </section>
              </article>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}
