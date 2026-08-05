import { StatusBadge } from '../components/StatusBadge'

const services = [
  {
    name: 'Relay Console',
    description: 'React application and API Worker',
    status: 'healthy' as const,
    latency: '42 ms',
    detail: 'Last check 12 seconds ago',
  },
  {
    name: 'Delivery scheduler',
    description: 'D1-backed claim and retry loop',
    status: 'healthy' as const,
    latency: '61 ms',
    detail: '25-record claim ceiling',
  },
  {
    name: 'Relay Lab',
    description: 'Deterministic webhook receiver',
    status: 'healthy' as const,
    latency: '87 ms',
    detail: 'Four scenarios available',
  },
  {
    name: 'Billing Platform',
    description: 'External destination health',
    status: 'degraded' as const,
    latency: '431 ms',
    detail: 'Recent HTTP 503 responses',
  },
]

export function SystemHealthPage() {
  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Reliability</p>
          <h1>System health</h1>
          <p className="page-header__description">
            Review delivery infrastructure, scheduler activity, and current operational limits.
          </p>
        </div>

        <div className="health-summary">
          <span className="health-summary__pulse" aria-hidden="true" />
          All core systems operational
        </div>
      </header>

      <div className="health-metrics">
        <article className="panel">
          <span>Queued deliveries</span>
          <strong>18</strong>
          <small>Oldest queued for 2m 14s</small>
        </article>

        <article className="panel">
          <span>Scheduler claims</span>
          <strong>36,000</strong>
          <small>Daily ceiling: 50,000</small>
        </article>

        <article className="panel">
          <span>Success rate</span>
          <strong>99.94%</strong>
          <small>Across the last 24 hours</small>
        </article>

        <article className="panel">
          <span>Median latency</span>
          <strong>184 ms</strong>
          <small>Outbound delivery attempts</small>
        </article>
      </div>

      <div className="health-layout">
        <article className="panel">
          <div className="panel__header">
            <div>
              <h2>Service status</h2>
              <p>Deterministic Phase 1 health fixtures</p>
            </div>
          </div>

          <div className="service-list">
            {services.map((service) => (
              <div className="service-row" key={service.name}>
                <div>
                  <strong>{service.name}</strong>
                  <span>{service.description}</span>
                </div>

                <StatusBadge status={service.status} />

                <div className="service-row__metric">
                  <strong>{service.latency}</strong>
                  <span>{service.detail}</span>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="panel guardrail-panel">
          <div className="panel__header">
            <div>
              <h2>Operational guardrails</h2>
              <p>Committed project-owned ceilings</p>
            </div>
          </div>

          <dl className="guardrail-list">
            <div>
              <dt>Scheduler interval</dt>
              <dd>1 minute</dd>
            </div>
            <div>
              <dt>Claims per tick</dt>
              <dd>25 maximum</dd>
            </div>
            <div>
              <dt>Delivery attempts</dt>
              <dd>8 maximum</dd>
            </div>
            <div>
              <dt>Request timeout</dt>
              <dd>10 seconds</dd>
            </div>
            <div>
              <dt>Payload size</dt>
              <dd>256 KiB</dd>
            </div>
            <div>
              <dt>Retention</dt>
              <dd>30 days</dd>
            </div>
          </dl>
        </article>
      </div>
    </section>
  )
}
