# Relay

Relay is a reliable outbound webhook delivery platform built on Cloudflare Workers and D1.

## Project Status

Relay has completed Phase 4: endpoint and secret security.

Relay accepts authenticated events, creates delivery fanout atomically, publishes work through a durable outbox, consumes Cloudflare Queue messages, claims deliveries with leases, signs stable webhook requests, records attempt evidence, classifies failures, schedules bounded retries, and recovers expired leases.

Phase 4 adds strict public-HTTPS endpoint URL policy, signed challenge-response endpoint verification, mandatory re-verification after URL changes, encrypted endpoint-specific signing secrets, bounded dual-signature secret rotation, delivery suppression for inactive endpoints, hardened signed owner sessions with CSRF protection, fail-closed per-key and global daily quotas, restrictive browser-origin policy, security headers, and generic server error responses.

Phase 5 will connect the operational Console to production data and delivery controls.

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

Relay uses Cloudflare D1 and Queue bindings configured through `wrangler.jsonc`. Endpoint signing secrets are stored encrypted in D1 with AES-GCM and decrypted at delivery time using a versioned Worker-held master key.

Document non-secret examples in `.env.example`. Store local Worker secrets in an ignored `.dev.vars` file. Never commit credentials, tokens, signing secrets, or production identifiers.

## Documentation

- [Architecture decisions](docs/adr)
- [Cost guardrails](docs/architecture/cost-guardrails.md)
- [Threat model](docs/threat-model/README.md)

## License

MIT
