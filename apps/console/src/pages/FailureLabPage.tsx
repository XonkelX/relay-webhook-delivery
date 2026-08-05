import { useState } from 'react'

type FailureMode = 'http-500' | 'timeout' | 'invalid-signature' | 'success'

const modeDescriptions: Record<FailureMode, string> = {
  'http-500': 'Return an HTTP 500 response so Relay schedules a retry.',
  timeout: 'Delay the receiver beyond the configured request timeout.',
  'invalid-signature': 'Reject the request because signature verification fails.',
  success: 'Accept the webhook and return HTTP 204.',
}

export function FailureLabPage() {
  const [failureMode, setFailureMode] = useState<FailureMode>('http-500')
  const [latencyMs, setLatencyMs] = useState(450)

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Receiver simulation</p>
          <h1>Failure Lab</h1>
          <p className="page-header__description">
            Configure deterministic receiver behavior and inspect how Relay responds.
          </p>
        </div>

        <button className="primary-button" type="button">
          Run simulation
        </button>
      </header>

      <div className="failure-lab-grid">
        <article className="panel failure-controls">
          <div className="panel__header">
            <div>
              <h2>Scenario controls</h2>
              <p>Static Phase 1 interaction model</p>
            </div>
          </div>

          <div className="control-stack">
            <label>
              <span>Receiver behavior</span>
              <select
                value={failureMode}
                onChange={(event) => setFailureMode(event.target.value as FailureMode)}
              >
                <option value="http-500">HTTP 500</option>
                <option value="timeout">Request timeout</option>
                <option value="invalid-signature">Invalid signature</option>
                <option value="success">Successful delivery</option>
              </select>
            </label>

            <label>
              <span>Simulated latency</span>
              <div className="range-row">
                <input
                  type="range"
                  min="0"
                  max="12000"
                  step="50"
                  value={latencyMs}
                  onChange={(event) => setLatencyMs(Number(event.target.value))}
                />
                <output>{latencyMs.toLocaleString()} ms</output>
              </div>
            </label>

            <label>
              <span>Receiver URL</span>
              <input type="url" value="https://lab.relay.example/scenario" readOnly />
            </label>
          </div>
        </article>

        <article className="panel scenario-preview">
          <div className="panel__header">
            <div>
              <h2>Expected outcome</h2>
              <p>Preview before running the simulation</p>
            </div>
          </div>

          <div className="scenario-preview__body">
            <div className={`scenario-icon scenario-icon--${failureMode}`}>
              {failureMode === 'success' ? '204' : '!'}
            </div>

            <h3>{failureMode === 'http-500' ? 'HTTP 500' : failureMode.replaceAll('-', ' ')}</h3>
            <p>{modeDescriptions[failureMode]}</p>

            <dl className="scenario-facts">
              <div>
                <dt>Latency</dt>
                <dd>{latencyMs.toLocaleString()} ms</dd>
              </div>
              <div>
                <dt>Expected Relay state</dt>
                <dd>{failureMode === 'success' ? 'Delivered' : 'Retrying'}</dd>
              </div>
              <div>
                <dt>Fixture mode</dt>
                <dd>Deterministic</dd>
              </div>
            </dl>
          </div>
        </article>
      </div>
    </section>
  )
}
