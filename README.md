# Relay

Relay is a reliable outbound webhook delivery platform built on Cloudflare Workers and D1.

## Project Status

Relay has completed Phase 2: durable ingestion and data foundations.

The authenticated `POST /v1/events` path now validates and persists events, enforces idempotency, creates delivery fanout atomically, records usage and audit evidence, publishes delivery messages through a durable outbox, and recovers pending outbox rows on a schedule.

The Phase 3 asynchronous delivery consumer, webhook signing, HTTP execution, retry scheduling, and attempt processing are not implemented yet.

## Delivery Guarantee

Relay provides at-least-once delivery. An event may be delivered more than once, so receivers must implement idempotent processing.

## Initial Scope

- One authenticated owner
- Read-only public demo mode
- Cloudflare Workers and D1
- Standard Webhooks-compatible signing
- Relay Console and Relay Lab

## Non-Goals

- Multi-tenant organizations or role-based access control
- Exactly-once delivery
- General-purpose workflow automation
- Replacement for a message queue or event bus

## Local Setup

1. Install dependencies: `npm ci`
2. Install Chromium: `npx playwright install chromium`
3. Apply local D1 migrations: `npm run db:migrate:local`
4. Start Console: `npm run dev --workspace=apps/console`
5. Start Lab: `npm run dev --workspace=apps/lab`

## Validation

- `npm run format-check`
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run build`
- `npm run test:e2e`
- `npm run check:cost`
- `npm audit --omit=dev`

## Environment Variables

Relay currently uses Cloudflare D1 and Queue bindings configured through `wrangler.jsonc`. It does not require plaintext runtime environment variables for local Phase 2 operation.

Document non-secret examples in `.env.example`. Store local Worker secrets in an ignored `.dev.vars` file. Never commit credentials, tokens, signing secrets, or production identifiers.

## Documentation

- [Architecture decisions](docs/adr)
- [Cost guardrails](docs/architecture/cost-guardrails.md)
- [Threat model](docs/threat-model/README.md)

## License

MIT
