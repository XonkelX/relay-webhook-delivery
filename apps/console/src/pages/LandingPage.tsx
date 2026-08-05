import { Link } from 'react-router'

const capabilities = [
  {
    title: 'Durable delivery',
    description: 'Persist every event and attempt so retries survive interrupted execution.',
  },
  {
    title: 'Deterministic retries',
    description: 'Inspect retry schedules, exhaustion states, and replay lineage.',
  },
  {
    title: 'Signed requests',
    description: 'Use a Standard Webhooks-compatible signing format across Relay and Relay Lab.',
  },
]

export function LandingPage() {
  return (
    <main className="landing">
      <nav className="landing-nav" aria-label="Public navigation">
        <Link className="landing-brand" to="/">
          <span className="brand__mark" aria-hidden="true">
            R
          </span>
          <span>Relay</span>
        </Link>

        <div className="landing-nav__actions">
          <Link className="secondary-button" to="/console/events">
            View demo
          </Link>
          <Link className="primary-button" to="/console">
            Open console
          </Link>
        </div>
      </nav>

      <section className="landing-hero">
        <div className="landing-hero__copy">
          <p className="eyebrow">Reliable outbound webhooks</p>
          <h1>Delivery infrastructure you can inspect.</h1>
          <p>
            Relay signs, schedules, retries, and records outbound webhook deliveries without hiding
            their lifecycle behind a black box.
          </p>

          <div className="landing-hero__actions">
            <Link className="primary-button" to="/console">
              Explore Relay
            </Link>
            <Link className="secondary-button" to="/console/failure-lab">
              Open Failure Lab
            </Link>
          </div>

          <dl className="landing-proof">
            <div>
              <dt>Delivery guarantee</dt>
              <dd>At least once</dd>
            </div>
            <div>
              <dt>Scheduler</dt>
              <dd>D1-backed</dd>
            </div>
            <div>
              <dt>Signing</dt>
              <dd>Standard Webhooks</dd>
            </div>
          </dl>
        </div>

        <div className="landing-terminal" aria-label="Example delivery lifecycle">
          <div className="landing-terminal__bar">
            <span />
            <span />
            <span />
            <code>relay.delivery</code>
          </div>

          <div className="landing-terminal__body">
            <p>
              <span>01</span>
              event.accepted
            </p>
            <p>
              <span>02</span>
              signature.generated
            </p>
            <p>
              <span>03</span>
              attempt.timeout
            </p>
            <p>
              <span>04</span>
              retry.scheduled +5m
            </p>
            <p className="landing-terminal__success">
              <span>05</span>
              delivery.completed 204
            </p>
          </div>
        </div>
      </section>

      <section className="landing-capabilities">
        {capabilities.map((capability, index) => (
          <article key={capability.title}>
            <span>0{index + 1}</span>
            <h2>{capability.title}</h2>
            <p>{capability.description}</p>
          </article>
        ))}
      </section>
    </main>
  )
}
