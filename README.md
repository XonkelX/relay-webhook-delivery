# Relay

Relay is a reliable outbound webhook delivery platform built on Cloudflare Workers and D1.

## Project Status

Relay is currently in Phase 0: repository framing, architecture decisions, local infrastructure, testing, and quality gates.

Production webhook delivery is not implemented yet.

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

Phase 0 does not require runtime environment variables.

Document non-secret examples in `.env.example`. Store local Worker secrets in an ignored `.dev.vars` file. Never commit credentials, tokens, signing secrets, or production identifiers.

## Documentation

- [Architecture decisions](docs/adr)
- [Cost guardrails](docs/architecture/cost-guardrails.md)
- [Threat model](docs/threat-model/README.md)

## License

MIT
